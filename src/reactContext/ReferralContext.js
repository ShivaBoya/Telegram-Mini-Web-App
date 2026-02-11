// src/reactContext/ReferralContext.js

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useTelegram } from "./TelegramContext.js";
import { database } from "../services/FirebaseConfig.js";
import {
  ref,
  get,
  update,
  onValue,
  runTransaction
} from "firebase/database";

const ReferralContext = createContext();
export const useReferral = () => useContext(ReferralContext);

export const ReferralProvider = ({ children }) => {
  const { user } = useTelegram();

  const [inviteLink, setInviteLink] = useState("");
  const [invitedFriends, setInvitedFriends] = useState([]);
  const [showWelcomePopup, setShowWelcomePopup] = useState(false);

  // ==========================================
  // SAFE SCORE UPDATE
  // ==========================================
  const updateScores = useCallback(async (userId, amount) => {
    const networkRef = ref(database, `users/${userId}/Score/network_score`);
    const totalRef = ref(database, `users/${userId}/Score/total_score`);

    await runTransaction(networkRef, (current) => (current || 0) + amount);
    await runTransaction(totalRef, (current) => (current || 0) + amount);
  }, []);

  // ==========================================
  // ADD REFERRAL RECORD
  // ==========================================
  const addReferralRecord = useCallback(async (referrerId, referredId) => {

    if (!referrerId || !referredId) return;
    if (String(referrerId) === String(referredId)) return;

    const referrerSnap = await get(ref(database, `users/${referrerId}`));
    const referredSnap = await get(ref(database, `users/${referredId}`));

    if (!referrerSnap.exists()) return;
    if (!referredSnap.exists()) return;

    const alreadyReferred = await get(ref(database, `users/${referredId}/referredBy`));
    if (alreadyReferred.exists()) return;

    const referrerName = referrerSnap.val().name || "Unknown";

    const updates = {};

    updates[`users/${referredId}/referredBy`] = {
      id: String(referrerId),
      name: referrerName
    };

    updates[`users/${referredId}/referralSource`] = "Invite";

    updates[`users/${referrerId}/referrals/${referredId}`] = {
      id: String(referredId),
      joinedAt: Date.now()
    };

    await update(ref(database), updates);

    // LEVEL 1
    await updateScores(referrerId, 100);
    await updateScores(referredId, 50);

    // LEVEL 2
    const parent = referrerSnap.val().referredBy;
    if (parent?.id) {
      await updateScores(parent.id, 20);

      const grandSnap = await get(ref(database, `users/${parent.id}`));
      const grand = grandSnap.val()?.referredBy;

      if (grand?.id) {
        await updateScores(grand.id, 10);
      }
    }

  }, [updateScores]);

  // ==========================================
  // HANDLE INVITE / DIRECT
  // ==========================================
  useEffect(() => {
    if (!user?.id) return;

    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();

    const processReferral = async () => {

      let startParam = tg.initDataUnsafe?.start_param;

      if (!startParam) {
        const urlParams = new URL(window.location.href).searchParams;
        startParam = urlParams.get("tgWebAppStartParam");
      }

      const currentUserId = String(user.id);

      if (startParam && startParam.startsWith("ref_")) {

        const parts = startParam.split("_");

        if (parts.length >= 3) {
          const referrerId = parts[2];

          await addReferralRecord(String(referrerId), currentUserId);
          setShowWelcomePopup(true);
          return;
        }
      }

      // Only set Direct if referralSource not already set
      const sourceSnap = await get(ref(database, `users/${currentUserId}/referralSource`));

      if (!sourceSnap.exists()) {
        await update(ref(database, `users/${currentUserId}`), {
          referralSource: "Direct"
        });
      }
    };

    processReferral();

  }, [user?.id, addReferralRecord]);

  // ==========================================
  // GENERATE INVITE LINK
  // ==========================================
  useEffect(() => {
    if (!user?.id) return;

    const botUsername =
      process.env.REACT_APP_BOT_USERNAME || "Web3TodayGameAppTelegram_bot";

    const code = btoa(`${user.id}_${Date.now()}`)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 12);

    setInviteLink(
      `https://t.me/${botUsername}/app?startapp=ref_${code}_${user.id}`
    );

  }, [user?.id]);

  // ==========================================
  // REFERRAL LIST (NAME FIXED)
  // ==========================================
  useEffect(() => {
    if (!user?.id) return;

    const referralsRef = ref(database, `users/${user.id}/referrals`);

    const unsubscribe = onValue(referralsRef, async (snapshot) => {

      const data = snapshot.val();

      if (!data) {
        setInvitedFriends([]);
        return;
      }

      const list = await Promise.all(
        Object.keys(data).map(async (referredId) => {

          const snap = await get(ref(database, `users/${referredId}`));

          return {
            id: referredId,
            name: snap.exists()
              ? snap.val().name || "Unknown"
              : "Unknown",
            referralDate: data[referredId]?.joinedAt || 0
          };
        })
      );

      setInvitedFriends(list);

    });

    return () => unsubscribe();

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
