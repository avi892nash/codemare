import { Router } from 'express';
import { execute, pollSubmission } from '../controllers/executionController.js';
import { executionRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// POST /v1/execute        — submit (sync with ?wait=true, else async token)
router.post('/', executionRateLimit, execute);
// GET  /v1/execute/:token — poll an async submission
router.get('/:token', pollSubmission);

export default router;
