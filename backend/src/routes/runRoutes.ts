import express, { Router } from 'express';
import { runJson, runStream } from '../controllers/runController.js';
import { executionRateLimit } from '../middleware/rateLimit.js';
import { RUN_BODY_LIMIT } from '../services/runValidation.js';

const router = Router();

// The run payload carries every test (inputs + expected), so it gets a larger
// body limit than the app-wide 1 MB. It is parsed here — after the internal
// token check on the parent router — so unauthenticated callers can't make
// the service buffer a multi-MB body. app.ts skips its default parser for
// these paths.
router.use(express.json({ limit: RUN_BODY_LIMIT }));

// POST /v1/run         — JSON result
router.post('/', executionRateLimit, runJson);
// POST /v1/run/stream  — Server-Sent Events
router.post('/stream', executionRateLimit, runStream);

export default router;
