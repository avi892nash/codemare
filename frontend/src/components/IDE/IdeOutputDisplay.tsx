import { IdeExecutionResponse } from '../../types/execution';

interface IdeOutputDisplayProps {
  results: IdeExecutionResponse | null;
}

export function IdeOutputDisplay({ results }: IdeOutputDisplayProps) {
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
        <p className="text-gray-400 text-sm mt-1">
          Total execution time: {results.totalExecutionTime.toFixed(2)}ms
        </p>
      </div>

      {/* Test Results */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white mb-4">Test Results</h3>
        {results.testResults.map((testResult, index) => (
          <div
            key={index}
            className={`rounded-lg border-2 p-4 ${
              testResult.passed
                ? 'bg-green-900/10 border-green-700'
                : 'bg-red-900/10 border-red-700'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-white font-semibold">
                Test Case {index + 1}
              </h4>
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-sm">
                  {testResult.executionTime.toFixed(2)}ms
                </span>
                <span
                  className={`px-3 py-1 rounded text-sm font-semibold ${
                    testResult.passed
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white'
                  }`}
                >
                  {testResult.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
            </div>

            {/* Input */}
            <div className="mb-3">
              <label className="text-gray-400 text-sm font-medium block mb-1">
                Input (stdin):
              </label>
              <pre className="bg-gray-800 text-gray-200 p-3 rounded font-mono text-sm overflow-x-auto border border-gray-700">
                {testResult.input || '<empty>'}
              </pre>
            </div>

            {/* Expected Output */}
            <div className="mb-3">
              <label className="text-gray-400 text-sm font-medium block mb-1">
                Expected Output (stdout):
              </label>
              <pre className="bg-gray-800 text-gray-200 p-3 rounded font-mono text-sm overflow-x-auto border border-gray-700">
                {testResult.expectedOutput || '<empty>'}
              </pre>
            </div>

            {/* Actual Output */}
            <div className="mb-3">
              <label className="text-gray-400 text-sm font-medium block mb-1">
                Actual Output (stdout):
              </label>
              <pre
                className={`p-3 rounded font-mono text-sm overflow-x-auto border ${
                  testResult.passed
                    ? 'bg-gray-800 text-gray-200 border-gray-700'
                    : 'bg-red-900/20 text-red-200 border-red-700'
                }`}
              >
                {testResult.actualOutput || '<empty>'}
              </pre>
            </div>

            {/* Error if any */}
            {testResult.error && (
              <div>
                <label className="text-red-400 text-sm font-medium block mb-1">
                  Error:
                </label>
                <pre className="bg-red-900/20 text-red-200 p-3 rounded font-mono text-sm overflow-x-auto border border-red-700">
                  {testResult.error}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
