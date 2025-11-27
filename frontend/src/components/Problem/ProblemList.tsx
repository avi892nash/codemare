import { useState, useEffect } from 'react';
import { problemsApi } from '../../services/api';
import { ProblemListItem, Difficulty } from '../../types/problem';
import { useEditor } from '../../context/EditorContext';

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  Easy: 'text-green-500',
  Medium: 'text-yellow-500',
  Hard: 'text-red-500',
};

export function ProblemList() {
  const [problems, setProblems] = useState<ProblemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentProblem, setCurrentProblem } = useEditor();

  useEffect(() => {
    loadProblems();
  }, []);

  const loadProblems = async () => {
    try {
      setLoading(true);
      const data = await problemsApi.getAll();
      setProblems(data);
      setError(null);
    } catch (err) {
      setError('Failed to load problems');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleProblemClick = async (problemId: string) => {
    try {
      const problem = await problemsApi.getById(problemId);
      setCurrentProblem(problem);
    } catch (err) {
      console.error('Failed to load problem:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading problems...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold text-white mb-4">Problems</h2>
      <div className="space-y-2">
        {problems.map((problem) => (
          <div
            key={problem.id}
            onClick={() => handleProblemClick(problem.id)}
            className={`p-4 rounded-lg cursor-pointer transition-colors ${
              currentProblem?.id === problem.id
                ? 'bg-blue-900 border-2 border-blue-500'
                : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">{problem.title}</h3>
              <span className={`text-sm font-semibold ${DIFFICULTY_COLORS[problem.difficulty]}`}>
                {problem.difficulty}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
