import { Request, Response } from 'express';
import { IdeExecutionRequest } from '../models/IdeExecution.js';
import { executeIdeCode } from '../services/ideExecutionService.js';
import { validateIdeRequest } from '../services/validationService.js';

/**
 * Execute IDE code with custom test cases
 * POST /api/ide/execute
 */
export async function executeIde(req: Request, res: Response): Promise<void> {
  try {
    const request: IdeExecutionRequest = req.body;

    // Validate request
    const validation = validateIdeRequest(request);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    // Execute code
    const result = await executeIdeCode(request);

    // Return results
    res.json(result);
  } catch (error) {
    console.error('IDE execution error:', error);
    res.status(500).json({
      error: 'Failed to execute code',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
