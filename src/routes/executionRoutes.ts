import { Router } from 'express';
import { execute } from '../controllers/executionController.js';
import { executionRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// POST /api/execute - Execute code with rate limiting
router.post('/', executionRateLimit, execute);

export default router;
