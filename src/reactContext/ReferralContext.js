// src/reactContext/ReferralContext.js

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTelegram } from './TelegramContext.js';
import { database } from '../services/FirebaseConfig.js';
import { ref, get, update, set, onValue, query, orderByChild, equalTo } from 'firebase/database';

const ReferralContext = createContext();
export const useReferral = () => useContext(ReferralContext);

export const ReferralProvider = ({ children }) => {
  const { user } = useTelegram();

  const [inviteLink, setInviteLink] = useState('');
  const [invitedFriends, setInvitedFriends] = useState([]);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  // DB updates - wrapped in useCallback
  const updateScores = React.useCallback(async (refId, amount) => {
    // Update network_score
    const scoreRef = ref(database, `users/${refId}/Score/network_score`);
    const snap = await get(scoreRef);
    const curr = snap.exists() ? snap.val() : 0;
    await set(scoreRef, curr + amount);

    // Update total_score
    const totalRef = ref(database, `users/${refId}/Score/total_score`);
    const totalSnap = await get(totalRef);
    const tot = totalSnap.exists() ? totalSnap.val() : 0;
    await set(totalRef, tot + amount);
  }, []);

  const addReferralRecord = React.useCallback(async (referrerId, referredId) => {
    console.log(`[ReferralContext] Processing 3-Level Referral: ${referrerId} -> ${referredId}`);

    // 1. Validate Referrer Exists
    const referrerUserRef = ref(database, `users/${referrerId}`);
    const userSnap = await get(referrerUserRef);
    if (!userSnap.exists()) {
      console.error(`[Referral] Referrer ${referrerId} does not exist.`);
      return;
    }

    // 2. Check Loop or Duplicate (Double check DB)
    const processedCheckRef = ref(database, `users/${referredId}/referredBy`);
    const processedSnap = await get(processedCheckRef);
    if (processedSnap.exists()) {
      console.log(`[Referral] User ${referredId} already referred by ${processedSnap.val()}`);
      return;
    }

    // 3. DEFINE REWARDS (3 Levels)
    const REWARD_L1 = 100; // Direct
    const REWARD_L2 = 20;  // Parent
    const REWARD_L3 = 10;  // Grandparent

    const updates = {};
    const timestamp = Date.now(); // Re-added used variable


    // --- LINKING (New Schema) ---
    // User -> Referrer
    updates[`users/${referredId}/referredBy`] = referrerId;
    updates[`users/${referredId}/referralSource`] = "Invite";

    // Referrer -> User (Store details for UI display)
    // We need the referred user's name. 
    // We can fetch it, or if it's a new user, we might not have it yet if this runs concurrently?
    // Actually, this runs AFTER user creation.
    let referredName = "Unknown";
    try {
      const referredSnap = await get(ref(database, `users/${referredId}`));
      if (referredSnap.exists()) {
        referredName = referredSnap.val().name || "Unknown";
      }
    } catch (e) { console.error("Error fetching referred name", e); }


    updates[`users/${referrerId}/referrals/${referredId}`] = {
      id: referredId,
      name: referredName,
      joinedAt: timestamp
    };

    // --- REWARD DISTRIBUTION ---

    // Level 1: Direct Referrer
    await updateScores(referrerId, REWARD_L1);
    console.log(`[Referral] L1 Reward (${REWARD_L1}) to ${referrerId}`);

    // Level 2: Parent of Referrer
    try {
      const p2Ref = ref(database, `users/${referrerId}/referredBy`);
      const p2Snap = await get(p2Ref);
      if (p2Snap.exists()) {
        const p2Id = p2Snap.val();
        // Verify P2 exists to be safe
        if (p2Id && typeof p2Id === 'string') {
          await updateScores(p2Id, REWARD_L2);
          console.log(`[Referral] L2 Reward (${REWARD_L2}) to ${p2Id}`);

          // Level 3: Grandparent (Parent of P2)
          const p3Ref = ref(database, `users/${p2Id}/referredBy`);
          const p3Snap = await get(p3Ref);
          if (p3Snap.exists()) {
            const p3Id = p3Snap.val();
            if (p3Id && typeof p3Id === 'string') {
              await updateScores(p3Id, REWARD_L3);
              console.log(`[Referral] L3 Reward (${REWARD_L3}) to ${p3Id}`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[Referral] Error in Multi-Level Distribution:", err);
    }

    // Execute Linking Updates Atomic
    await update(ref(database), updates);

    // Give new user starting bonus? (Original code gave 50). Keeping it? User prompt didn't mention it, but usually expected.
    // User Prompt: "Level 1... I receive 100...". Didn't specify New User reward.
    // I will keep the existing 50 bonus for the new user to avoid regression, or remove if strictly following prompt.
    // Prompt says "Reward Distribution Summary... Level 1, 2, 3". No mention of new user.
    // But previous code had `await updateScores(referredId, 50);`. I'll keep it to be nice, or remove to be strict.
    // I'll keep it as a "Welcome Bonus" outside the "Referral Reward System" description.
    await updateScores(referredId, 50);

  }, [updateScores]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      console.log('[Referral] Telegram object not found');
      return;
    }

    tg.ready();
    console.log('[Referral] tg.ready() was called');

    // Try to get the param from Telegram SDK
    let startParam = tg.initDataUnsafe?.start_param;
    console.log('[Referral] Raw startParam:', startParam);

    // FALLBACK: If not found in SDK, check URL parameters (e.g. ?tgWebAppStartParam=...)
    if (!startParam) {
      const urlParams = new URL(window.location.href).searchParams;
      startParam = urlParams.get('tgWebAppStartParam');
      console.log('[Referral] URL startParam:', startParam);
    }

    const referredId = tg.initDataUnsafe?.user?.id;
    console.log('[Referral] Current User ID (Referred):', referredId);

    if (!startParam || !referredId) {
      console.log('[Referral] Missing startParam or referredId');
      return;
    }

    /* Expected format: ref_CODE_USERID or ref_USERID */
    const parts = startParam.split('_');
    let referrerId = parts[2]; // Default for 3-part: ref_CODE_USERID

    if (!referrerId && parts.length === 2 && /^\d+$/.test(parts[1])) {
      // Fallback for 2-part: ref_USERID
      referrerId = parts[1];
    }

    console.log('[Referral] Extracted referrerId:', referrerId);

    if (!referrerId || referrerId === String(referredId)) {
      console.log('[Referral] Invalid referrerId (or self-referral)');
      return;
    }

    const key = `referred_${referredId}_${referrerId}`; // Made key unique to referrer-referred pair
    if (localStorage.getItem(key)) {
      console.log('[Referral] LocalStorage flag already set → abort');
      return;
    }

    console.log('[Referral] All guards passed – calling addReferralRecord');
    addReferralRecord(referrerId, referredId)
      .then(() => {
        console.log('[Referral] addReferralRecord resolved – show popup');
        localStorage.setItem(key, 'done');
        setShowWelcomePopup(true);
        // Optional: Show alert for testing
        // tg.showAlert(`Referral processed! You were invited by ${referrerId}`);
      })
      .catch(err => {
        console.error('[Referral] addReferralRecord rejected:', err);
      });

  }, [user.id, addReferralRecord]);




  useEffect(() => {
    if (user?.id) {
      const code = btoa(`${user.id}_${Date.now()}`)
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 12);

      // Use the environment variable for bot username, fallback to a placeholder if missing
      const botUsername = process.env.REACT_APP_BOT_USERNAME || 'Web3TodayGameAppTelegram_bot';

      // BotFather is configured! We can now use 'startapp' for correct tracking.
      // Format: https://t.me/BOT_USERNAME?startapp=ref_CODE_USERID
      setInviteLink(`https://t.me/${botUsername}/app?startapp=ref_${code}_${user.id}`);
    }
  }, [user?.id]);




  useEffect(() => {
    if (!user?.id) return;

    // 🚀 HYBRID LOOKUP: Query BOTH the local 'referrals' node AND the global 'users' node (Reverse Lookup)
    // This ensures we catch:
    // 1. New referrals (stored in local node with name/date)
    // 2. Old/Legacy referrals (linked only via 'referredBy' on their profile)

    // 🚀 HYBRID LOOKUP: Query BOTH the local 'referrals' node AND the global 'users' node (Reverse Lookup)
    // This ensures we catch:
    // 1. New referrals (stored in local node with name/date)
    // 2. Old/Legacy referrals (linked only via 'referredBy' on their profile)

    // const referralsRef = ref(database, `users/${user.id}/referrals`); // Unused variable removed

    const usersRef = ref(database, 'users');
    const reverseQuery = query(usersRef, orderByChild('referredBy'), equalTo(String(user.id)));

    // normalizeReferral Removed - Not used in pure reverse lookup logic below

    // RESTORING REVERSE LOOKUP AS PRIMARY SOURCE OF TRUTH
    const unsub = onValue(reverseQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const list = Object.values(data).map(u => ({
        id: u.id || 'Unknown',
        name: u.name || 'Unknown',
        points: u.Score?.network_score || 0,
        status: u.status || 'active',
        referralDate: u.joinedAt || 0
      }));
      console.log(`[ReferralContext] Found ${list.length} referrals via Reverse Lookup`);
      setInvitedFriends(list);
    }, (error) => {
      console.error("[ReferralContext] Error querying referrals:", error);
      // Fallback? No, if this fails, we have bigger issues.
    });

    return () => unsub();
  }, [user?.id]);



  const shareToTelegram = React.useCallback(() => window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Join me and earn rewards!')}`, '_blank'), [inviteLink]);
  const shareToWhatsApp = React.useCallback(() => window.open(`https://wa.me/?text=${encodeURIComponent(`Join me and earn rewards! ${inviteLink}`)}`, '_blank'), [inviteLink]);
  const shareToTwitter = React.useCallback(() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join me and earn rewards! ${inviteLink}`)}`, '_blank'), [inviteLink]);
  const copyToClipboard = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      return true;
    } catch (err) {
      console.error('Failed to copy: ', err);
      return false;
    }
  }, [inviteLink]);

  const value = React.useMemo(() => ({
    inviteLink,
    invitedFriends,
    shareToTelegram,
    shareToWhatsApp,
    shareToTwitter,
    copyToClipboard,
    showWelcomePopup,
    setShowWelcomePopup
  }), [
    inviteLink,
    invitedFriends,
    showWelcomePopup,
    shareToTelegram,
    shareToWhatsApp,
    shareToTwitter, // Now stable via useCallback
    copyToClipboard
  ]);

  return (
    <ReferralContext.Provider value={value}>
      {children}
    </ReferralContext.Provider>
  );
};
