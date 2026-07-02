import { Router, type Request, type Response } from 'express';
import { getQueueStats } from '../queue/queue.js';

const router = Router();

// GET /v1/queue/stats — live queue depth for tuning/observability.
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    res.json(await getQueueStats());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'stats failed' });
  }
});

export default router;
