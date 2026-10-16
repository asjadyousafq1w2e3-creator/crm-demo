/**
 * Test defaults for the secrets the app refuses to run without. Imported first so they are set
 * before lib/config.ts reads process.env. Real values in the environment always win.
 */
process.env.SESSION_SECRET ||= "test-secret";
process.env.TOKEN_ENCRYPTION_KEY ||= "a".repeat(64);
process.env.EMAIL_MODE ||= "mock";
process.env.ENABLE_LIVE_EMAIL_SENDING ||= "false";
