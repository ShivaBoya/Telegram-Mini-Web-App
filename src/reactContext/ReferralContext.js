import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTelegram } from './TelegramContext.js';
import { database } from '../services/FirebaseConfig.js';
import { ref, get, update, onValue, runTransaction } from 'firebase/database';
import { BOT_USERNAME, isBotConfigValid } from '../config/botConfig';

const ReferralContext = createContext();
export const useReferral = () => useContext(ReferralContext);

export const ReferralProvider = ({ children }) => {
  const { user } = useTelegram();
  const [inviteLink, setInviteLink] = useState('');
  const [invitedFriends, setInvitedFriends] = useState([]);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);
  const [referralError, setReferralError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ENV Variable for Bot Username - Source of Truth
  // Imported from ../config/botConfig

  // 1. Parse Start Param & Handle New Referrals
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;
    tg.ready();

    const initReferral = async () => {
      const startParam = tg.initDataUnsafe?.start_param;
      const currentUserId = tg.initDataUnsafe?.user?.id;

      if (!startParam || !currentUserId || isProcessing) return;

      // Expected format: ref_CODE_REFERRERID
      const parts = startParam.split('_');
      // parts[0] = 'ref', parts[1] = code, parts[2] = referrerId
      const referrerId = parts[2];

      // Basic Validation
      if (!referrerId || String(referrerId) === String(currentUserId)) {
        return; 
      }

      // LocalStorage Optimization (Client-side Check)
      const key = `referral_processed_${currentUserId}`;
      if (localStorage.getItem(key)) {
        return; 
      }

      setIsProcessing(true);
      
      try {
        await processReferral(referrerId, currentUserId, user);
        localStorage.setItem(key, 'done');
        setShowWelcomePopup(true);
      } catch (error) {
        console.error("Referral processing failed:", error);
      } finally {
        setIsProcessing(false);
      }
    };

    initReferral();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // Run once when user loads

  // 2. Atomic Transaction for Referral Recording
  // 2. Atomic Transaction for Referral Recording
  const processReferral = async (referrerId, newUserId, currentUserData) => {
    const referrerRef = ref(database, `users/${referrerId}`);
    
    // Helper to recalculate total score from components
    const calculateTotal = (scores) => {
       return (scores.farming_score || 0) + 
              (scores.network_score || 0) + 
              (scores.game_score || 0) + 
              (scores.task_score || 0) + 
              (scores.news_score || 0);
    };

    // A. Transaction on Referrer's User Object
    await runTransaction(referrerRef, (referrerData) => {
      if (!referrerData) return referrerData; // Referrer must exist

      if (!referrerData.referrals) referrerData.referrals = {};
      
      // Idempotency: Check if this specific user ID is already in the referral map
      if (referrerData.referrals[newUserId]) {
        return; // Already referred this user
      }

      // 1. Add Rich Referral Data (Single Source of Truth)
      referrerData.referrals[newUserId] = {
         id: newUserId,
         id: newUserId,
         name: currentUserData?.username ? `@${currentUserData.username}` : (currentUserData?.displayName || "Anonymous"), // Prefer Handle
         joinTimestamp: Date.now(),
         status: 'active',
         currentStreak: 1 // Default for new user
      };

      // 2. Atomic Score Update (Self-Healing)
      if (!referrerData.Score) referrerData.Score = {};
      
      // Update Network Component
      referrerData.Score.network_score = (referrerData.Score.network_score || 0) + 100;
      
      // Recalculate Total to ensure consistency
      referrerData.Score.total_score = calculateTotal(referrerData.Score);

      return referrerData;
    });

    // B. Transaction on New User's Object (The Referee)
    const newUserRef = ref(database, `users/${newUserId}`);
    await runTransaction(newUserRef, (userData) => {
      // Case 1: User does not exist yet (Race Condition Fix)
      if (!userData) {
          const initialScores = {
              network_score: 50, // Bonus
              total_score: 50,   // Bonus
              farming_score: 0,
              game_score: 0,
              task_score: 0,
              news_score: 0,
              game_highest_score: 0,
              no_of_tickets: 3
          };
          
          return {
            name: currentUserData?.username ? `@${currentUserData.username}` : (currentUserData?.displayName || "Anonymous"),
            isReferred: true,
            referredBy: referrerId,
            Score: initialScores,
            // Add other defaults
            lastUpdated: Date.now(),
            lastPlayed: Date.now(),
            streak: { currentStreakCount: 1, lastStreakCheckDateUTC: new Date().toISOString().split('T')[0] }
          };
      }

      // Case 2: User already exists
      if (userData.isReferred) return; // Prevent double-dipping

      if (!userData.Score) userData.Score = {};
      
      // Update Network Component
      userData.Score.network_score = (userData.Score.network_score || 0) + 50;
      
      // Recalculate Total
      userData.Score.total_score = calculateTotal(userData.Score);
      
      userData.isReferred = true; // Mark as referred
      userData.referredBy = referrerId;

      return userData;
    });
  };

  // 3. Generate Environement-Aware Invite Link
  useEffect(() => {
    // START VALIDATION: Check Config Validity
    if (!isBotConfigValid) {
       console.error("Referral Error: BOT_USERNAME is invalid or missing in configuration.");
       setInviteLink(null);
       setReferralError("Bot Configuration Missing");
       return;
    }

    // Check User Auth
    if (!user?.id) {
       // Only log if we expect a user (not pure web test)
       // console.warn("Referral: Waiting for User ID...");
       setInviteLink(null);
       // We don't set error here, as it might just be loading
       return;
    }

    // Use timestamp to make the code unique if needed, or simple ID structure
    // Format: ref_{UniqueCode}_{UserId}
    const uniqueCode = btoa(`${user.id}_${Date.now()}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    
    // CONSTRUCT LINK USING VALIDATED CONSTANT
    const link = `https://t.me/${BOT_USERNAME}?startapp=ref_${uniqueCode}_${user.id}`;
    setInviteLink(link);
    setReferralError(null);
  }, [user?.id]); // BOT_USERNAME/isBotConfigValid are constants

  // 4. Fetch Invited Friends List (Real-time and Rich)
  useEffect(() => {
    if (!user?.id) return;
    const referralsRef = ref(database, `users/${user.id}/referrals`);
    
    // We listen to the referrals node.
    // It now contains: { "USER_ID": { name: "...", timestamp: ... }, ... }
    const unsubscribe = onValue(referralsRef, async (snapshot) => {
      const data = snapshot.val() || {};
      const referralEntries = Object.values(data); // These are the objects we stored
      
      if (referralEntries.length === 0) {
        setInvitedFriends([]);
        return;
      }

      // OPTIMIZATION: Set Immediate State (Prevent "Loading" or Empty State)
      // This shows the list instantly using the name we stored at referral time.
      // We map it to the structure UI expects.
      setInvitedFriends(referralEntries.map(entry => ({
         id: entry.id,
         name: entry.name || 'Unknown',
         points: 0, // Fallback until live fetch
         status: entry.status || 'active',
         streak: entry.currentStreak || 0
      })));

      // Then, fetch LIVE data in background to update scores
      try {
        const promises = referralEntries.map(async (entry) => {
          const friendId = entry.id; // We stored 'id' in the object
          if (!friendId) return null;

          try {
            // OPTIMIZATION: Fetch SPECIFIC paths to avoid downloading the friend's entire 'referrals' node.
            // This massively reduces bandwidth if your friends have friends.
            const [scoreSnap, streakSnap, usernameSnap, nameSnap] = await Promise.all([
               get(ref(database, `users/${friendId}/Score`)),
               get(ref(database, `users/${friendId}/streak`)),
               get(ref(database, `users/${friendId}/username`)),
               get(ref(database, `users/${friendId}/name`))
            ]);

            if (scoreSnap.exists()) {
               const scores = scoreSnap.val();
               const streakData = streakSnap.val();
               const username = usernameSnap.val();
               const name = nameSnap.val();

               const bestName = username ? `@${username}` : (name || entry.name || 'Unknown');
               const totalScore = scores?.total_score || 0;

               // Status Logic:
               // JOINED: Default state (Score 0)
               // ACTIVE: Has earned points (> 0)
               let status = 'joined';
               if (totalScore > 0) status = 'active';

               return {
                 id: friendId,
                 name: bestName, 
                 points: scores?.network_score || 0,
                 status: status,
                 streak: streakData?.currentStreakCount || 0
               };
            }
            // If user doesn't exist (deleted?), return the stored entry as fallback
            return {
               id: friendId,
               name: entry.name || 'Unknown',
               points: 0,
               status: 'inactive',
               streak: 0
            };
          } catch (e) {
             console.warn(`Failed to fetch friend ${friendId}`, e);
             return entry; // Return stored data on error
          }
        });

        const results = await Promise.all(promises);
        setInvitedFriends(results.filter(Boolean));
      } catch (err) {
        console.error("Error fetching friends details:", err);
      }
    });

    return () => unsubscribe();
  }, [user?.id]);

  // Public Methods
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      return true;
    } catch {
      return false;
    }
  };

  const shareToTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("Join me and earn rewards!")}`;
    window.open(url, '_blank');
  };

  const shareToWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(`Join me and earn rewards! ${inviteLink}`)}`;
    window.open(url, '_blank');
  };

  const shareToTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join me and earn rewards! ${inviteLink}`)}`;
    window.open(url, '_blank');
  };

  return (
    <ReferralContext.Provider value={{
      inviteLink,
      referralError, // Expose error state
      invitedFriends,
      shareToTelegram,
      shareToWhatsApp,
      shareToTwitter,
      copyToClipboard,
      showWelcomePopup,
      setShowWelcomePopup
    }}>
      {children}
    </ReferralContext.Provider>
  );
};
