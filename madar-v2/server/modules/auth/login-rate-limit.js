import rateLimit from 'express-rate-limit';

export const LOGIN_RATE_LIMIT_MESSAGE = 'تم تجاوز الحد المسموح من محاولات الدخول. يرجى الانتظار لمدة دقيقة.';

/** Shared by both login endpoints so switching forms cannot reset the per-IP budget. */
export const loginRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({ error: LOGIN_RATE_LIMIT_MESSAGE });
  },
});
