import { Router } from 'express';
import { executeIde } from '../controllers/ideExecutionController.js';
import { executionRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// POST /api/ide/execute
router.post('/execute', executionRateLimit, executeIde);

export default router;
