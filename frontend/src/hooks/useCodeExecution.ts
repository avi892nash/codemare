import { useState } from 'react';
import { executionApi } from '../services/api';
import { ExecutionRequest, ExecutionResponse } from '../types/execution';

export function useCodeExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<ExecutionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeCode = async (request: ExecutionRequest) => {
    try {
      setIsExecuting(true);
      setError(null);
      const response = await executionApi.execute(request);
      setResults(response);
      return response;
    } catch (err) {
      const errorMessage = 'Failed to execute code';
      setError(errorMessage);
      console.error(err);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  const clearResults = () => {
    setResults(null);
    setError(null);
  };

  return { executeCode, isExecuting, results, error, clearResults };
}
