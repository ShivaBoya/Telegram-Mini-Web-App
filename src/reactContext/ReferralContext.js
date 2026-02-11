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

  // 🔥 DEV MODE (TURN OFF AFTER TESTING)
  const DEV_MODE = true;

  // =========================
  // SAFE SCORE UPDATE
  // =========================
  const updateScores = React.useCallback(async (refId, amount) => {
    const scoreRef = ref(database, `users/${refId}/Score/network_score`);
    await runTransaction(scoreRef, (current) => (current || 0) + amount);

    const totalRef = ref(database, `users/${refId}/Score/total_score`);
    await runTransaction(totalRef, (current) => (current || 0) + amount);
  }, []);

  // =========================
  // ADD REFERRAL RECORD
  // =========================
  const addReferralRecord = React.useCallback(async (referrerId, referredId) => {
    console.log(`[Referral] Processing: ${referrerId} -> ${referredId}`);

    const referrerUserRef = ref(database, `users/${referrerId}`);
    const userSnap = await get(referrerUserRef);
    if (!userSnap.exists()) return;

    // 🔥 Duplicate protection (disabled in DEV_MODE)
    const duplicateCheck = await get(ref(database, `users/${referredId}/referredBy`));

    if (!DEV_MODE && duplicateCheck.exists()) {
      console.log("[Referral] Duplicate detected. Skipping.");
      return;
    }

    const REWARD_L1 = 100;
    const REWARD_L2 = 20;
    const REWARD_L3 = 10;

    const updates = {};
    const timestamp = Date.now();

    const referrerName = userSnap.val().name || "Unknown";

    updates[`users/${referredId}/referredBy`] = referrerId;
    updates[`users/${referredId}/referredByName`] = referrerName;
    updates[`users/${referredId}/referralSource`] = "Invite";

    const referredSnap = await get(ref(database, `users/${referredId}`));
    const referredName = referredSnap.exists()
      ? referredSnap.val().name || "Unknown"
      : "Unknown";

    updates[`users/${referrerId}/referrals/${referredId}`] = {
      id: referredId,
      name: referredName,
      joinedAt: timestamp
    };

    // Link first
    await update(ref(database), updates);

    // Rewards
    await updateScores(referrerId, REWARD_L1);

    const p2Snap = await get(ref(database, `users/${referrerId}/referredBy`));
    if (p2Snap.exists()) {
      const p2Id = p2Snap.val();
      await updateScores(p2Id, REWARD_L2);

      const p3Snap = await get(ref(database, `users/${p2Id}/referredBy`));
      if (p3Snap.exists()) {
        const p3Id = p3Snap.val();
        await updateScores(p3Id, REWARD_L3);
      }
    }

    await updateScores(referredId, 50);

  }, [updateScores, DEV_MODE]);

  // =========================
  // SINGLE CONTROLLED EFFECT
  // =========================
  useEffect(() => {
    if (!user?.id) return;

    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();

    const process = async () => {
      let startParam = tg.initDataUnsafe?.start_param;

      if (!startParam) {
        const urlParams = new URL(window.location.href).searchParams;
        startParam = urlParams.get('tgWebAppStartParam');
      }

      const referredId = tg.initDataUnsafe?.user?.id;
      if (!referredId) return;

      // ===== INVITE CASE =====
      if (startParam) {
        const parts = startParam.split('_');
        let referrerId = parts[2];

        if (!referrerId && parts.length === 2 && /^\d+$/.test(parts[1])) {
          referrerId = parts[1];
        }

        if (!referrerId || referrerId === String(referredId)) return;

        const key = `referred_${referredId}_${referrerId}`;
        if (!DEV_MODE && localStorage.getItem(key)) return;

        await addReferralRecord(referrerId, referredId);
        localStorage.setItem(key, 'done');
        setShowWelcomePopup(true);
        return;
      }

      // ===== DIRECT CASE =====
      const sourceSnap = await get(ref(database, `users/${user.id}/referralSource`));
      if (!sourceSnap.exists()) {
        await update(ref(database, `users/${user.id}`), {
          referralSource: "Direct",
          referredBy: null,
          referredByName: null
        });
      }
    };

    process();
  }, [user?.id, addReferralRecord, DEV_MODE]);

  // =========================
  // INVITE LINK
  // =========================
  useEffect(() => {
    if (user?.id) {
      const code = btoa(`${user.id}_${Date.now()}`)
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 12);

      const botUsername =
        process.env.REACT_APP_BOT_USERNAME || 'Web3TodayGameAppTelegram_bot';

      setInviteLink(
        `https://t.me/${botUsername}/app?startapp=ref_${code}_${user.id}`
      );
    }
  }, [user?.id]);

  // =========================
  // REFERRAL LIST
  // =========================
  useEffect(() => {
    if (!user?.id) return;

    const referralsRef = ref(database, `users/${user.id}/referrals`);
    const usersRef = ref(database, 'users');
    const reverseQuery = query(
      usersRef,
      orderByChild('referredBy'),
      equalTo(String(user.id))
    );

    const unsubLocal = onValue(referralsRef, async (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const list = await Promise.all(
        Object.entries(data).map(async ([key, val]) => {
          const id = val.id || key;
          const snap = await get(ref(database, `users/${id}/name`));
          return {
            id,
            name: snap.val() || "Unknown User",
            referralDate: val.joinedAt || 0
          };
        })
      );

      setInvitedFriends(list);
    });

    const unsubReverse = onValue(reverseQuery, () => { });

    return () => {
      unsubLocal();
      unsubReverse();
    };
  }, [user?.id]);

  const value = {
    inviteLink,
    invitedFriends,
    showWelcomePopup,
    setShowWelcomePopup
  };

  return (
    <ReferralContext.Provider value={value}>
      {children}
    </ReferralContext.Provider>
  );
};
