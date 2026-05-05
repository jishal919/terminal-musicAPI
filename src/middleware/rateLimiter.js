/**
 * middleware/rateLimiter.js
 *
 * Sliding-window rate limiter using express-rate-limit.
 * Default: 60 requests per minute per IP.
 *
 * Configured via env vars:
 *   RATE_LIMIT_WINDOW_MS  (default: 60000  — 1 minute)
 *   RATE_LIMIT_MAX        (default: 60     — requests per window)
 */

const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '60',    10),
  standardHeaders: true,   // Return `RateLimit-*` headers
  legacyHeaders:   false,  // Disable `X-RateLimit-*`
  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      error:   'Too many requests — please slow down.',
      retryAfter: res.getHeader('Retry-After'),
    });
  },
  skip: (req) => req.path === '/health', // never limit the health check
});

module.exports = limiter;
