/**
 * Centralized Bot Configuration
 * 
 * Responsibilities:
 * 1. Read process.env.REACT_APP_BOT_USERNAME
 * 2. Validate against Telegram username rules
 * 3. Export validation status to prevent invalid link generation
 */

// Read from environment
const rawBotUsername = process.env.REACT_APP_BOT_USERNAME;

// Normalize: trim whitespace
const normalizedBotUsername = rawBotUsername ? rawBotUsername.trim() : '';

/**
 * Validates the bot username based on strict rules:
 * - Non-empty
 * - No spaces
 * - Ends with "bot" (case-insensitive)
 */
const isValidBotUsername = (username) => {
  if (!username) return false;
  
  // harmful characters check (basic sanity)
  if (/\s/.test(username)) return false;
  
  // Must end with 'bot'
  if (!username.toLowerCase().endsWith('bot')) return false;

  return true;
};

export const isBotConfigValid = isValidBotUsername(normalizedBotUsername);

// Export the username only if valid, otherwise undefined (or empty string if preferred, usage will check isValid)
export const BOT_USERNAME = isBotConfigValid ? normalizedBotUsername : null;

// Debug log for development (safe to log boolean)
if (process.env.NODE_ENV === 'development') {
    console.log(`[BotConfig] Username provided: ${!!rawBotUsername}`);
    console.log(`[BotConfig] Config valid: ${isBotConfigValid}`);
    if (!isBotConfigValid) {
        console.warn('[BotConfig] REACT_APP_BOT_USERNAME is missing or invalid. Referral links will be disabled.');
    }
}
