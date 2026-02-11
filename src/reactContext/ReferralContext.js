// src/reactContext/ReferralContext.js

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback
} from "react";

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

  // 🔥 ==============================
  // 🔥 DEV CONFIG (TURN OFF IN PROD)
  // 🔥 ==============================
  const DEV_FORCE_REFERRAL = true;      // 🔥 set false in production
  const DEV_REFERRER_ID = "6743986736"; // 🔥 your Telegram ID

  // ======================================
  // SAFE SCORE UPDATE (TRANSACTION SAFE)
  // ======================================
  const updateScores = useCallback(async (userId, amount) => {
    const userRef = ref(database, `users/${userId}`);

    try {
      await runTransaction(userRef, (userData) => {
        if (!userData) return userData;

        if (!userData.Score) {
          userData.Score = {
            farming_score: 0,
            network_score: 0,
            game_score: 0,
            news_score: 0,
            task_score: 0,
            total_score: 0,
            game_highest_score: 0,
            no_of_tickets: 3,
          };
        }

        userData.Score.network_score =
          (userData.Score.network_score || 0) + amount;

        userData.Score.total_score =
          (userData.Score.total_score || 0) + amount;

        return userData;
      });

      console.log(`✅ +${amount} added to ${userId}`);
    } catch (error) {
      console.error("❌ Transaction failed:", error);
    }
  }, []);

  // ======================================
  // ADD REFERRAL RECORD
  // ======================================
  const addReferralRecord = useCallback(async (referrerId, referredId) => {
    if (!referrerId || !referredId) return;
    if (String(referrerId) === String(referredId)) {
      console.log("❌ Self referral blocked");
      return;
    }

    const referrerSnap = await get(ref(database, `users/${referrerId}`));
    const referredSnap = await get(ref(database, `users/${referredId}`));

    if (!referrerSnap.exists() || !referredSnap.exists()) {
      console.log("❌ Referrer or referred user not found");
      return;
    }

    const alreadyReferred = await get(
      ref(database, `users/${referredId}/referredBy`)
    );

    if (alreadyReferred.exists()) {
      console.log("⚠️ Referral already processed");
      return;
    }

    const referrerName = referrerSnap.val().name || "Unknown";

    const updates = {};
    const timestamp = Date.now();

    updates[`users/${referredId}/referredBy`] = {
      id: String(referrerId),
      name: referrerName
    };

    updates[`users/${referredId}/referralSource`] = "Invite";

    updates[`users/${referrerId}/referrals/${referredId}`] = {
      id: String(referredId),
      joinedAt: timestamp,
      xp: 50
    };

    await update(ref(database), updates);

    // 🔥 LEVEL 1
    await updateScores(referrerId, 100);
    await updateScores(referredId, 50);

    // 🔥 LEVEL 2
    const parent = referrerSnap.val().referredBy;
    if (parent?.id) {
      await updateScores(parent.id, 20);

      const grandSnap = await get(
        ref(database, `users/${parent.id}`)
      );

      const grand = grandSnap.val()?.referredBy;

      if (grand?.id) {
        await updateScores(grand.id, 10);
      }
    }

    console.log("🎉 Referral completed");
  }, [updateScores]);

  // ======================================
  // HANDLE INVITE / DIRECT
  // ======================================
  useEffect(() => {
    if (!user?.id) return;

    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();

    const processReferral = async () => {
      let startParam = tg.initDataUnsafe?.start_param;

      // 🔥 DEV FORCE MODE
      if (!startParam && DEV_FORCE_REFERRAL) {
        startParam = `ref_dev_${DEV_REFERRER_ID}`;
        console.log("🔥 DEV referral forced");
      }

      const currentUserId = String(user.id);

      if (startParam && startParam.startsWith("ref_")) {
        const parts = startParam.split("_");

        if (parts.length >= 3) {
          const referrerId = parts[2];

          await addReferralRecord(
            String(referrerId),
            currentUserId
          );

          setShowWelcomePopup(true);
          return;
        }
      }

      const sourceSnap = await get(
        ref(database, `users/${currentUserId}/referralSource`)
      );

      if (!sourceSnap.exists()) {
        await update(ref(database, `users/${currentUserId}`), {
          referralSource: "Direct"
        });
      }
    };

    processReferral();
  }, [user?.id, addReferralRecord]);

  // ======================================
  // GENERATE INVITE LINK
  // ======================================
  useEffect(() => {
    if (!user?.id) return;

    const botUsername =
      process.env.REACT_APP_BOT_USERNAME ||
      "Web3TodayGameAppTelegram_bot";

    const code = btoa(`${user.id}_${Date.now()}`)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 12);

    setInviteLink(
      `https://t.me/${botUsername}?startapp=ref_${code}_${user.id}`
    );
  }, [user?.id]);

  // ======================================
  // REFERRAL LIST
  // ======================================
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
        Object.entries(data).map(async ([id, val]) => {
          const snap = await get(ref(database, `users/${id}`));
          const userData = snap.exists() ? snap.val() : null;

          return {
            id,
            name: userData?.name || "Unknown",
            referralDate: val?.joinedAt || 0,
            xp: val?.xp || 50
          };
        })
      );

      setInvitedFriends(list);
    });

    return () => unsubscribe();
  }, [user?.id]);

  // ======================================
  // SHARE HELPERS
  // ======================================
  const copyToClipboard = useCallback(async () => {
    if (!inviteLink) return false;
    await navigator.clipboard.writeText(inviteLink);
    return true;
  }, [inviteLink]);

  const shareToTelegram = useCallback(() => {
    if (!inviteLink) return;
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}`,
      "_blank"
    );
  }, [inviteLink]);

  const shareToWhatsApp = useCallback(() => {
    if (!inviteLink) return;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(inviteLink)}`,
      "_blank"
    );
  }, [inviteLink]);

  const shareToTwitter = useCallback(() => {
    if (!inviteLink) return;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteLink)}`,
      "_blank"
    );
  }, [inviteLink]);

  const value = {
    inviteLink,
    invitedFriends,
    showWelcomePopup,
    setShowWelcomePopup,
    copyToClipboard,
    shareToTelegram,
    shareToWhatsApp,
    shareToTwitter
  };

  return (
    <ReferralContext.Provider value={value}>
      {children}
    </ReferralContext.Provider>
  );
};
