// // import { database } from "../services/FirebaseConfig";
// // import { ref, get, set } from "firebase/database";

// // export const initializeUser = async (user) => {

// //   if (!user) {
// //     console.error("User data not available");
// //     return null;
// //   }

// //   const userId = user?.id.toString();


// //   const userRef = ref(database, `users/${userId}`);

// //   try {
// //     const snapshot = await get(userRef);
// //     if (!snapshot.exists()) {
// //       await set(userRef, {
// //         name: user.first_name || "Anonymous",
// //         lastUpdated: Date.now(),
// //         lastPlayed: Date.now(),
// //         Score: {
// //           farming_score: 0,
// //           network_score: 0,
// //           game_score: 0,
// //           news_score: 0,
// //           task_score: 0,
// //           total_score: 0,
// //           game_highest_score: 0,
// //           no_of_tickets:3,
// //         },
// //       });
// //       console.log("New user created:", userId);
// //     } else {
// //       console.log("User already exists:", userId);
// //     }

// //     return userId;
// //   } catch (error) {
// //     console.error("Error checking/creating user:", error);
// //     return null;
// //   }
// // };
// import { database } from "../services/FirebaseConfig";
// import { ref, get, update, set } from "firebase/database";

// export const initializeUser = async (user, startParam) => {
//   if (!user) {
//     console.error("User data not available");
//     return null;
//   }
//   //!SECTION

//   const userId = user?.id.toString();
//   const userRef = ref(database, `users/${userId}`);

//   try {
//     const snapshot = await get(userRef);
//     if (!snapshot.exists()) {
//       // Determine Referral Source and Data
//       let referralSource = "Direct";
//       let referredByData = null;

//       // Robust startParam check: generic argument OR direct from SDK as fallback
//       const effectiveStartParam = startParam || window.Telegram?.WebApp?.initDataUnsafe?.start_param;
//       console.log(`[InitializeUser] Processing startParam: "${effectiveStartParam}" for user: ${userId}`);

//       if (effectiveStartParam) {
//         // Try parsing different formats
//         let referrerId = null;
//         const parts = effectiveStartParam.split('_');

//         if (parts.length >= 3 && parts[0] === 'ref') {
//           // Format: ref_CODE_USERID
//           referrerId = parts[2];
//         } else if (parts.length === 1 && /^\d+$/.test(parts[0])) {
//           // Format: USERID (Legacy or direct ID)
//           referrerId = parts[0];
//         }

//         console.log(`[InitializeUser] Extracted Referrer ID: ${referrerId}`);

//         if (referrerId && referrerId !== userId) {
//           referralSource = "Invite";

//           // Fetch Referrer's Name
//           try {
//             const referrerSnap = await get(ref(database, `users/${referrerId}`));
//             // Ensure we don't crash if referrer doesn't exist
//             if (referrerSnap.exists()) {
//               const referrerName = referrerSnap.val().name || "Unknown";
//               referredByData = { id: referrerId, name: referrerName };
//               console.log(`[InitializeUser] Referrer found: ${referrerName} (${referrerId})`);
//             } else {
//               console.log(`[InitializeUser] Referrer ID ${referrerId} not found in DB.`);
//               referredByData = { id: referrerId, name: "Unknown" };
//             }
//           } catch (err) {
//             console.error("Error fetching referrer name:", err);
//             referredByData = { id: referrerId, name: "Unknown" };
//           }
//         } else {
//           console.log(`[InitializeUser] Invalid Referrer ID (Self-referral or missing)`);
//         }
//       } else {
//         console.log(`[InitializeUser] No startParam found.`);
//       }

//       // New user: set all fields
//       await set(userRef, {
//         name: user.first_name || "Anonymous",
//         lastUpdated: Date.now(),
//         lastPlayed: Date.now(),
//         lastReset: { daily: new Date().toISOString().split('T')[0] }, // Add lastReset
//         Score: {
//           farming_score: 0,
//           network_score: 0,
//           game_score: 0,
//           news_score: 0,
//           task_score: 0,
//           total_score: 0,
//           game_highest_score: 0,
//           no_of_tickets: 3,
//         },
//         streak: {
//           currentStreakCount: 1,
//           lastStreakCheckDateUTC: new Date().toISOString().split('T')[0],
//           longestStreakCount: 1
//         },
//         referralSource: referralSource,
//         ...(referredByData && { referredBy: referredByData })
//       });
//       console.log(`New user created: ${userId} via ${referralSource}`);
//     } else {
//       // Existing user: patch missing fields only (non-destructive)
//       const userData = snapshot.val();
//       const updates = {};

//       if (!userData.lastReset) {
//         updates.lastReset = { daily: new Date().toISOString().split('T')[0] };
//       }
//       if (!userData.streak) {
//         updates.streak = {
//           currentStreakCount: 1,
//           lastStreakCheckDateUTC: new Date().toISOString().split('T')[0],
//           longestStreakCount: 1
//         };
//       }
//       // Optionally, patch Score fields if needed
//       if (!userData.Score) {
//         updates.Score = {
//           farming_score: 0,
//           network_score: 0,
//           game_score: 0,
//           news_score: 0,
//           task_score: 0,
//           total_score: 0,
//           game_highest_score: 0,
//           no_of_tickets: 3,
//         };
//       }

//       if (Object.keys(updates).length > 0) {
//         await update(userRef, updates);
//         console.log("User patched with missing fields:", userId, updates);
//       } else {
//         console.log("User already exists and is up to date:", userId);
//       }
//     }

//     return userId;
//   } catch (error) {
//     console.error("Error checking/creating user:", error);
//     return null;
//   }
// };

import { database } from "../services/FirebaseConfig";
import { ref, get, set } from "firebase/database";

export const initializeUser = async (user) => {
  if (!user) return null;

  const userId = String(user.id);
  const userName = user.first_name || "Anonymous";
  const todayUTC = new Date().toISOString().split("T")[0];

  const userRef = ref(database, `users/${userId}`);
  const snapshot = await get(userRef);

  // =============================
  // WAIT FOR TELEGRAM READY
  // =============================
  const tg = window.Telegram?.WebApp;
  tg?.ready();

  let startParam = tg?.initDataUnsafe?.start_param;

  if (!startParam) {
    const urlParams = new URL(window.location.href).searchParams;
    startParam = urlParams.get("tgWebAppStartParam");
  }

  let referralSource = "Direct";
  let referrerId = null;

  if (startParam) {
    const parts = startParam.split("_");

    if (parts.length >= 3 && parts[0] === "ref") {
      referrerId = parts[2];
    }

    if (referrerId && referrerId !== userId) {
      // Validate referrer exists
      const referrerSnap = await get(ref(database, `users/${referrerId}`));

      if (referrerSnap.exists()) {
        referralSource = "Invite";
      } else {
        referrerId = null; // invalid referrer
      }
    }
  }

  // =============================
  // NEW USER CREATION
  // =============================
  if (!snapshot.exists()) {
    const newUser = {
      id: userId,
      username: user.username || "Anonymous",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      name:
        (user.first_name || "") +
        (user.last_name ? " " + user.last_name : "") ||
        user.username ||
        "Anonymous",
      is_premium: user.is_premium || false,
      photo_url: user.photo_url || "",
      language_code: user.language_code || "en",
      Score: {
        farming_score: 0,
        network_score: 100, // 🔥 FIRST TIME BONUS
        game_score: 0,
        news_score: 0,
        task_score: 0,
        total_score: 100, // 🔥 MATCHES NETWORK SCORE
        game_highest_score: 0,
        no_of_tickets: 3,
      },
      streak: {
        count: 0,
        lastLoginDate: "",
      },
      joinedAt: Date.now(),
      lastUpdated: Date.now(), // Added from original newUserData
      lastPlayed: Date.now(), // Added from original newUserData
      lastReset: { daily: todayUTC }, // Added from original newUserData
      referralSource, // Added from original newUserData
    };

    if (referrerId) {
      newUser.referredBy = {
        id: referrerId,
      };
    }

    await set(userRef, newUser);

    // =============================
    // LINK TO REFERRER SAFELY
    // =============================
    if (referrerId) {

      const referralNode = ref(database, `users/${referrerId}/referrals/${userId}`);
      const existingLink = await get(referralNode);

      // Prevent duplicate linking
      if (!existingLink.exists()) {
        await set(referralNode, {
          id: userId,
          name: userName,
          joinedAt: Date.now(),
        });
      }
    }

    console.log("✅ User created:", userId, referralSource);
  }

  return userId;
};
