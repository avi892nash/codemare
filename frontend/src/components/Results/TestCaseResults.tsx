import { TestCaseResult } from '../../types/execution';

interface TestCaseResultsProps {
  results: TestCaseResult[];
}

export function TestCaseResults({ results }: TestCaseResultsProps) {
  return (
    <div className="space-y-3">
      {results.map((result, index) => (
        <div
          key={index}
          className={`rounded-lg p-4 border-2 ${
            result.passed
              ? 'bg-green-900/20 border-green-600'
              : 'bg-red-900/20 border-red-600'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`text-2xl ${
                  result.passed ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {result.passed ? 'PASS' : 'FAIL'}
              </span>
              <span className="font-semibold text-white">
                {result.hidden ? 'Hidden Test Case' : `Test Case ${index + 1}`}
              </span>
            </div>
            <span className="text-sm text-gray-400">
              {result.executionTime.toFixed(2)}ms
            </span>
          </div>

          {!result.hidden && (
            <>
              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Input:</div>
                <code className="block bg-gray-900 rounded px-3 py-2 text-gray-300 font-mono text-sm">
                  {JSON.stringify(result.input)}
                </code>
              </div>

              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Expected:</div>
                <code className="block bg-gray-900 rounded px-3 py-2 text-green-400 font-mono text-sm">
                  {JSON.stringify(result.expectedOutput)}
                </code>
              </div>

              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Your Output:</div>
                <code
                  className={`block bg-gray-900 rounded px-3 py-2 font-mono text-sm ${
                    result.passed ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {JSON.stringify(result.actualOutput)}
                </code>
              </div>
            </>
          )}

          {result.error && (
            <div className="mt-2">
              <div className="text-sm text-red-400 mb-1">Error:</div>
              <code className="block bg-red-900/30 rounded px-3 py-2 text-red-300 font-mono text-sm">
                {result.error}
              </code>
            </div>
          )}

          {result.hidden && (
            <div className="text-sm text-gray-400 italic">
              {result.passed
                ? 'Passed hidden test case'
                : 'Failed hidden test case'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
