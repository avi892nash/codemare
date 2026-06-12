import { Router } from 'express';
import { executeIde, pollIdeSubmission } from '../controllers/ideExecutionController.js';
import { executionRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// POST /v1/ide/execute        — submit (sync with ?wait=true, else async token)
router.post('/execute', executionRateLimit, executeIde);
// GET  /v1/ide/execute/:token — poll an async submission
router.get('/execute/:token', pollIdeSubmission);

export default router;
