import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for code execution endpoints
 * Limits each IP to 10 requests per minute to prevent abuse
 */
export const executionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute per IP
  message: { error: 'Too many code execution requests, please try again later' }, // sent as JSON, consistent with other errors
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

/**
 * General API rate limiter
 * More lenient limit for general API endpoints
 */
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: { error: 'Too many requests, please try again later' }, // sent as JSON, consistent with other errors
  standardHeaders: true,
  legacyHeaders: false,
});
