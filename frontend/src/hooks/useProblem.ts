import { useState, useEffect } from 'react';
import { problemsApi } from '../services/api';
import { Problem } from '../types/problem';

export function useProblem(problemId: string | null) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!problemId) {
      setProblem(null);
      return;
    }

    const loadProblem = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await problemsApi.getById(problemId);
        setProblem(data);
      } catch (err) {
        setError('Failed to load problem');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadProblem();
  }, [problemId]);

  return { problem, loading, error };
}
