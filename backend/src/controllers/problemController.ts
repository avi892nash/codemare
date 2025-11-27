import { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Problem, ProblemListItem } from '../models/Problem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROBLEMS_DIR = path.join(__dirname, '../data/problems');

/**
 * Get list of all problems
 */
export async function getProblems(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    const indexPath = path.join(PROBLEMS_DIR, 'index.json');
    const indexData = await readFile(indexPath, 'utf-8');
    const index: { problems: ProblemListItem[] } = JSON.parse(indexData);

    res.json({ problems: index.problems });
  } catch (error) {
    console.error('Error fetching problems:', error);
    res.status(500).json({
      error: 'Failed to fetch problems',
    });
  }
}

/**
 * Get specific problem by ID
 */
export async function getProblemById(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ error: 'Problem ID is required' });
      return;
    }

    const problemPath = path.join(PROBLEMS_DIR, `${id}.json`);
    const problemData = await readFile(problemPath, 'utf-8');
    const problem: Problem = JSON.parse(problemData);

    // Don't send hidden test case details to frontend
    const sanitizedProblem = {
      ...problem,
      testCases: problem.testCases.map((tc) => ({
        ...tc,
        input: tc.hidden ? [] : tc.input,
        expectedOutput: tc.hidden ? null : tc.expectedOutput,
      })),
    };

    res.json({ problem: sanitizedProblem });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      res.status(404).json({ error: 'Problem not found' });
    } else {
      console.error('Error fetching problem:', error);
      res.status(500).json({ error: 'Failed to fetch problem' });
    }
  }
}

/**
 * Get full problem data for backend use (includes hidden test cases)
 */
export async function getFullProblem(problemId: string): Promise<Problem> {
  const problemPath = path.join(PROBLEMS_DIR, `${problemId}.json`);
  const problemData = await readFile(problemPath, 'utf-8');
  return JSON.parse(problemData);
}
