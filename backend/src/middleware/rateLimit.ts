import rateLimit from 'express-rate-limit';

/**
 * Circuit breaker for the execution endpoints — NOT a per-user abuse guard.
 *
 * This service only ever sees one caller: the Next.js server, authenticated
 * via requireInternalToken. Every real end user's request arrives from that
 * same source IP, so a low per-IP cap here doesn't throttle abusive users —
 * it throttles the entire platform (10/min total was capping this at 1 run
 * every 6 seconds for ALL users combined). Real per-user throttling belongs
 * where user identity actually exists: web/lib/rateLimit.ts, applied in the
 * server actions that call this endpoint.
 *
 * What's left here is a generous, configurable safety valve against a
 * runaway caller (a retry-loop bug, a misbehaving script hitting this
 * endpoint directly) bounding queue growth — not a marketing-visible limit.
 */
export const executionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.EXECUTION_RATE_LIMIT_MAX ?? 6000), // ~100 req/s sustained per API process
  message: { error: 'Too many code execution requests, please try again later' }, // sent as JSON, consistent with other errors
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
