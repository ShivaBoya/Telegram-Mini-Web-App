// src/reactContext/ReferralContext.js

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTelegram } from './TelegramContext.js';
import { database } from '../services/FirebaseConfig.js';
import { ref, get, update, onValue, query, orderByChild, equalTo, runTransaction } from 'firebase/database';

const ReferralContext = createContext();
export const useReferral = () => useContext(ReferralContext);

export const ReferralProvider = ({ children }) => {
  const { user } = useTelegram();

  const [inviteLink, setInviteLink] = useState('');
  const [invitedFriends, setInvitedFriends] = useState([]);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  // DB updates - wrapped in useCallback
  const updateScores = React.useCallback(async (refId, amount) => {
    const scoreRef = ref(database, `users/${refId}/Score/network_score`);
    await runTransaction(scoreRef, (current) => {
      return (current || 0) + amount;
    });

    const totalRef = ref(database, `users/${refId}/Score/total_score`);
    await runTransaction(totalRef, (current) => {
      return (current || 0) + amount;
    });
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
    const timestamp = Date.now();


    // --- FETCH REFERRER NAME ---
    let referrerName = "Unknown";
    try {
      referrerName = userSnap.val().name || "Unknown";
    } catch (e) {
      console.error("Error fetching referrer name", e);
    }

    // --- LINKING (New Schema) ---
    updates[`users/${referredId}/referredBy`] = referrerId;
    updates[`users/${referredId}/referredByName`] = referrerName;
    updates[`users/${referredId}/referralSource`] = "Invite";

    // Referrer -> User (Store details for UI display)
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

    await updateScores(referrerId, REWARD_L1);
    console.log(`[Referral] L1 Reward (${REWARD_L1}) to ${referrerId}`);

    try {
      const p2Ref = ref(database, `users/${referrerId}/referredBy`);
      const p2Snap = await get(p2Ref);
      if (p2Snap.exists()) {
        const p2Id = p2Snap.val();
        if (p2Id && typeof p2Id === 'string') {
          await updateScores(p2Id, REWARD_L2);
          console.log(`[Referral] L2 Reward (${REWARD_L2}) to ${p2Id}`);

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

    // Give new user starting bonus
    await updateScores(referredId, 50);

  }, [updateScores]);

  // 🔥 HANDLE DIRECT USERS (NO REFERRAL CASE)
  useEffect(() => {
    if (!user?.id) return;

    const checkAndSetDirect = async () => {
      const sourceRef = ref(database, `users/${user.id}/referralSource`);
      const snap = await get(sourceRef);

      if (!snap.exists()) {
        await update(ref(database, `users/${user.id}`), {
          referralSource: "Direct",
          referredBy: null,
          referredByName: null
        });
        console.log("[Referral] User marked as Direct");
      }
    };

    checkAndSetDirect();
  }, [user?.id]);

  // 🔥 EVERYTHING BELOW REMAINS EXACTLY SAME (UNCHANGED)

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) {
      console.log('[Referral] Telegram object not found');
      return;
    }

    tg.ready();
    console.log('[Referral] tg.ready() was called');

    let startParam = tg.initDataUnsafe?.start_param;
    console.log('[Referral] Raw startParam:', startParam);

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

    const parts = startParam.split('_');
    let referrerId = parts[2];

    if (!referrerId && parts.length === 2 && /^\d+$/.test(parts[1])) {
      referrerId = parts[1];
    }

    console.log('[Referral] Extracted referrerId:', referrerId);

    if (!referrerId || referrerId === String(referredId)) {
      console.log('[Referral] Invalid referrerId (or self-referral)');
      return;
    }

    const key = `referred_${referredId}_${referrerId}`;
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
      })
      .catch(err => {
        console.error('[Referral] addReferralRecord rejected:', err);
      });

  }, [user.id, addReferralRecord]);

  // 🔥 RESTORED: Invite Link Generation
  useEffect(() => {
    if (user?.id) {
      const code = btoa(`${user.id}_${Date.now()}`)
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 12);
      const botUsername = process.env.REACT_APP_BOT_USERNAME || 'Web3TodayGameAppTelegram_bot';
      setInviteLink(`https://t.me/${botUsername}/app?startapp=ref_${code}_${user.id}`);
    }
  }, [user?.id]);


  // 🔥 RESTORED: Hybrid Referral Lookup (Fixes UI not showing referrals)
  useEffect(() => {
    if (!user?.id) return;

    const referralsRef = ref(database, `users/${user.id}/referrals`);
    const usersRef = ref(database, 'users');
    const reverseQuery = query(usersRef, orderByChild('referredBy'), equalTo(String(user.id)));

    // 1. Local Node Listener
    const unsubLocal = onValue(referralsRef, async (snapshot) => {
      const data = snapshot.val();
      if (!data) return; // Fallback to reverse lookup implies we don't clear list here

      const rawList = [];
      const processItem = (key, val) => {
        if (typeof val === 'string' || typeof val === 'number') {
          return { id: String(val), name: null, points: 50, referralDate: 0 };
        }
        if (val === true) {
          return { id: key, name: null, points: 50, referralDate: 0 };
        }
        if (typeof val === 'object') {
          return {
            id: val.id || key,
            name: val.name || null,
            points: 50,
            status: 'active',
            referralDate: val.joinedAt || val.timestamp || 0
          };
        }
        return null;
      };

      Object.entries(data).forEach(([key, val]) => {
        const item = processItem(key, val);
        if (item) rawList.push(item);
      });

      const enrichedList = await Promise.all(rawList.map(async (item) => {
        if (item.name && item.name !== "Unknown") return item;
        try {
          const snap = await get(ref(database, `users/${item.id}/name`));
          return { ...item, name: snap.val() || "Unknown User" };
        } catch (e) {
          return { ...item, name: "Unknown" };
        }
      }));

      console.log(`[ReferralContext] Loaded ${enrichedList.length} referrals from local node`);
      setInvitedFriends(prev => {
        if (enrichedList.length > 0) return enrichedList;
        return prev;
      });
    });

    // 2. Reverse Lookup Listener
    const unsubReverse = onValue(reverseQuery, (snapshot) => {
      const data = snapshot.val() || {};
      const list = Object.values(data).map(u => ({
        id: u.id || 'Unknown',
        name: u.name || 'Unknown',
        points: u.Score?.network_score || 0,
        status: u.status || 'active',
        referralDate: u.joinedAt || 0
      }));
      console.log(`[ReferralContext] Found ${list.length} referrals via Reverse Lookup`);

      setInvitedFriends(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = list.filter(i => !existingIds.has(i.id));
        return [...prev, ...newItems];
      });
    }, (error) => {
      console.error("[ReferralContext] Error querying referrals:", error);
    });

    return () => {
      unsubLocal();
      unsubReverse();
    };
  }, [user?.id]);


  // 🔥 RESTORED: Helper Functions
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
    shareToTwitter,
    copyToClipboard
  ]);

  return (
    <ReferralContext.Provider value={value}>
      {children}
    </ReferralContext.Provider>
  );
};
