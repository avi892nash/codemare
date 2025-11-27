import { Request, Response } from 'express';
import { ExecutionRequest } from '../models/ExecutionResult.js';
import {
  executeCode,
  validateExecutionRequest,
} from '../services/executionService.js';
import { getFullProblem } from './problemController.js';
import { sanitizeResults } from '../services/validationService.js';

/**
 * Execute user code against test cases
 */
export async function execute(req: Request, res: Response): Promise<void> {
  try {
    const executionRequest: ExecutionRequest = req.body;

    // Validate request
    const validation = validateExecutionRequest(executionRequest);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Get problem (with hidden test cases)
    let problem;
    try {
      problem = await getFullProblem(executionRequest.problemId);
    } catch {
      res.status(404).json({ error: 'Problem not found' });
      return;
    }

    // Execute code
    const result = await executeCode(executionRequest, problem);

    // Sanitize results (hide hidden test case details)
    const sanitizedResult = {
      ...result,
      testResults: sanitizeResults(result.testResults),
    };

    res.json(sanitizedResult);
  } catch (error) {
    console.error('Error executing code:', error);
    res.status(500).json({
      error: 'Failed to execute code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
