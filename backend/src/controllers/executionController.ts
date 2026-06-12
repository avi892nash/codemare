import { Request, Response } from 'express';
import { ExecutionRequest } from '../models/ExecutionResult.js';
import {
  executeCode,
  validateExecutionRequest,
} from '../services/executionService.js';
import { getFullProblem } from './problemController.js';
import { sanitizeResults } from '../services/validationService.js';
import { enqueue, getResult, isQueueEnabled } from '../queue/queue.js';

/**
 * Execute user code against test cases.
 *
 * Two modes:
 *   · Synchronous — `?wait=true`, or whenever the queue is disabled. Runs the
 *     submission inline and returns the full ExecutionResponse (200).
 *   · Asynchronous — queue enabled and `wait` not set. Enqueues the job and
 *     returns `{ token }` (202); the client polls GET /v1/submissions/:token.
 */
export async function execute(req: Request, res: Response): Promise<void> {
  try {
    const executionRequest: ExecutionRequest = req.body;

    const validation = validateExecutionRequest(executionRequest);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    let problem;
    try {
      problem = await getFullProblem(executionRequest.problemId);
    } catch {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    const wait = req.query.wait === 'true';
    if (wait || !isQueueEnabled()) {
      const result = await executeCode(executionRequest, problem);
      res.json({ ...result, testResults: sanitizeResults(result.testResults) });
      return;
    }

    const token = await enqueue({ kind: 'execute', request: executionRequest, problem });
    res.status(202).json({ token, status: 'PND' });
  } catch (error) {
    console.error('Error executing code:', error);
    res.status(500).json({
      error: 'Failed to execute code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Poll a queued submission by token.
 * GET /v1/submissions/:token
 */
export async function pollSubmission(req: Request, res: Response): Promise<void> {
  const poll = await getResult(req.params.token);
  switch (poll.state) {
    case 'not_found':
      res.status(404).json({ error: 'Unknown or expired token' });
      return;
    case 'pending':
      res.status(200).json({ status: 'PND' });
      return;
    case 'error':
      res.status(200).json({ status: 'XX', error: poll.error });
      return;
    case 'done':
      res.status(200).json(poll.result);
      return;
  }
}
