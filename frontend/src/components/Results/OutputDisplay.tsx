import { ExecutionResponse } from '../../types/execution';
import { TestCaseResults } from './TestCaseResults';
import { ExecutionStats } from './ExecutionStats';

interface OutputDisplayProps {
  results: ExecutionResponse | null;
}

export function OutputDisplay({ results }: OutputDisplayProps) {
  if (!results) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-gray-400 text-center">
          <p className="text-lg mb-2">No results yet</p>
          <p className="text-sm">Run your code to see the results</p>
        </div>
      </div>
    );
  }

  if (results.error) {
    return (
      <div className="p-6 bg-gray-900 h-full overflow-y-auto">
        <div className="bg-red-900/20 border-2 border-red-600 rounded-lg p-4">
          <h3 className="text-xl font-semibold text-red-500 mb-3">Error</h3>
          <pre className="text-red-300 font-mono text-sm whitespace-pre-wrap">
            {results.error}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-900 h-full overflow-y-auto">
      {/* Success/Failure Banner */}
      <div
        className={`rounded-lg p-4 mb-6 border-2 ${
          results.success
            ? 'bg-green-900/20 border-green-600'
            : 'bg-yellow-900/20 border-yellow-600'
        }`}
      >
        <h2
          className={`text-2xl font-bold ${
            results.success ? 'text-green-500' : 'text-yellow-500'
          }`}
        >
          {results.success ? 'All Tests Passed! 🎉' : 'Some Tests Failed'}
        </h2>
        <p className="text-gray-300 mt-2">
          {results.totalPassed} / {results.totalTests} test cases passed
        </p>
      </div>

      {/* Execution Stats */}
      <ExecutionStats
        totalPassed={results.totalPassed}
        totalTests={results.totalTests}
        executionTime={results.executionTime}
        memoryUsed={results.memoryUsed}
      />

      {/* Test Results */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold text-white mb-4">Test Results</h3>
        <TestCaseResults results={results.testResults} />
      </div>
    </div>
  );
}
