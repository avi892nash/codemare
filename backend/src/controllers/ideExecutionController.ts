import { Request, Response } from 'express';
import { IdeExecutionRequest } from '../models/IdeExecution.js';
import { executeIdeCode } from '../services/ideExecutionService.js';
import { validateIdeRequest } from '../services/validationService.js';
import { enqueue, getResult, isQueueEnabled } from '../queue/queue.js';

/**
 * Execute IDE code with custom test cases.
 * POST /v1/ide/execute  (sync with ?wait=true or queue disabled; else async token)
 */
export async function executeIde(req: Request, res: Response): Promise<void> {
  try {
    const request: IdeExecutionRequest = req.body;

    const validation = validateIdeRequest(request);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const wait = req.query.wait === 'true';
    if (wait || !isQueueEnabled()) {
      const result = await executeIdeCode(request);
      res.json(result);
      return;
    }

    const token = await enqueue({ kind: 'ide', request });
    res.status(202).json({ token, status: 'PND' });
  } catch (error) {
    console.error('IDE execution error:', error);
    res.status(500).json({
      error: 'Failed to execute code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Poll a queued IDE submission by token.
 * GET /v1/ide/submissions/:token
 */
export async function pollIdeSubmission(req: Request, res: Response): Promise<void> {
  const poll = await getResult(req.params.token);
  switch (poll.state) {
    case 'not_found':
      res.status(404).json({ error: 'Unknown or expired token' });
      return;
    case 'pending':
      res.status(200).json({ status: 'PND' });
      return;
    case 'error':
      res.status(200).json({ success: false, error: poll.error });
      return;
    case 'done':
      res.status(200).json(poll.result);
      return;
  }
}
