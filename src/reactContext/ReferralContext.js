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

  // 🔥 DEV TEST MODE (TURN OFF IN PRODUCTION)
  const DEV_FORCE_REFERRAL = true;
  const DEV_REFERRER_ID = "6743986736"; // your ID for testing

  // ======================================
  // SAFE SCORE UPDATE
  // ======================================
  const updateScores = useCallback(async (userId, amount) => {
    const networkRef = ref(database, `users/${userId}/Score/network_score`);
    const totalRef = ref(database, `users/${userId}/Score/total_score`);

    await runTransaction(networkRef, (current) => (current || 0) + amount);
    await runTransaction(totalRef, (current) => (current || 0) + amount);
  }, []);

  // ======================================
  // ADD REFERRAL RECORD
  // ======================================
  const addReferralRecord = useCallback(async (referrerId, referredId) => {
    if (!referrerId || !referredId) return;
    if (String(referrerId) === String(referredId)) return;

    const referrerSnap = await get(ref(database, `users/${referrerId}`));
    const referredSnap = await get(ref(database, `users/${referredId}`));

    if (!referrerSnap.exists() || !referredSnap.exists()) return;

    // Prevent duplicate referral
    const alreadyReferred = await get(
      ref(database, `users/${referredId}/referredBy`)
    );

    if (alreadyReferred.exists()) {
      console.log("User already referred. Skipping.");
      return;
    }

    const referrerName = referrerSnap.val().name || "Unknown";

    const timestamp = Date.now();

    const updates = {};

    // Save referral structure
    updates[`users/${referredId}/referredBy`] = {
      id: String(referrerId),
      name: referrerName
    };

    updates[`users/${referredId}/referralSource`] = "Invite";

    // Store inside referrer
    updates[`users/${referrerId}/referrals/${referredId}`] = {
      id: String(referredId),
      joinedAt: timestamp,
      xp: 50 // Friend's reward shown in list
    };

    await update(ref(database), updates);

    // LEVEL 1
    await updateScores(referrerId, 100);
    await updateScores(referredId, 50);

    // LEVEL 2 & 3
    const parentData = referrerSnap.val().referredBy;

    if (parentData?.id) {
      await updateScores(parentData.id, 20);

      const grandSnap = await get(
        ref(database, `users/${parentData.id}`)
      );

      const grandData = grandSnap.val()?.referredBy;

      if (grandData?.id) {
        await updateScores(grandData.id, 10);
      }
    }

    console.log("Referral completed successfully.");
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

      // 🔥 DEV FORCE REFERRAL
      if (DEV_FORCE_REFERRAL && !startParam) {
        startParam = `ref_test_${DEV_REFERRER_ID}`;
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

      // Only set Direct if referralSource doesn't exist
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

  }, [user?.id, addReferralRecord, DEV_FORCE_REFERRAL, DEV_REFERRER_ID]);

  // ======================================
  // GENERATE INVITE LINK (CORRECT MINI APP LINK)
  // ======================================
  useEffect(() => {
    if (!user?.id) return;

    const botUsername =
      process.env.REACT_APP_BOT_USERNAME || "Web3TodayGameAppTelegram_bot";

    const code = btoa(`${user.id}_${Date.now()}`)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 12);

    // ✅ Correct Mini App Link
    setInviteLink(
      `https://t.me/${botUsername}?startapp=ref_${code}_${user.id}`
    );

  }, [user?.id]);

  // ======================================
  // REFERRAL LIST (NO UNKNOWN + XP SUPPORT)
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
        Object.entries(data).map(async ([referredId, val]) => {

          const snap = await get(ref(database, `users/${referredId}`));

          const userData = snap.exists() ? snap.val() : null;

          return {
            id: referredId,
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
    try {
      if (inviteLink) {
        await navigator.clipboard.writeText(inviteLink);
        return true;
      }
    } catch (err) {
      console.error(err);
    }
    return false;
  }, [inviteLink]);

  const shareToTelegram = useCallback(() => {
    if (!inviteLink) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}`;
    window.open(url, "_blank");
  }, [inviteLink]);

  const shareToWhatsApp = useCallback(() => {
    if (!inviteLink) return;
    const url = `https://wa.me/?text=${encodeURIComponent(inviteLink)}`;
    window.open(url, "_blank");
  }, [inviteLink]);

  const shareToTwitter = useCallback(() => {
    if (!inviteLink) return;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteLink)}`;
    window.open(url, "_blank");
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
