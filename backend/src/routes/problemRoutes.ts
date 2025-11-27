import { Router } from 'express';
import { getProblems, getProblemById } from '../controllers/problemController.js';

const router = Router();

// GET /api/problems - Get all problems
router.get('/', getProblems);

// GET /api/problems/:id - Get specific problem
router.get('/:id', getProblemById);

export default router;
