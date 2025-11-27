interface ExecutionStatsProps {
  totalPassed: number;
  totalTests: number;
  executionTime: number;
  memoryUsed: number;
}

export function ExecutionStats({
  totalPassed,
  totalTests,
  executionTime,
  memoryUsed,
}: ExecutionStatsProps) {
  const passRate = (totalPassed / totalTests) * 100;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Pass Rate */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Pass Rate</div>
        <div className="text-2xl font-bold text-white">
          {passRate.toFixed(0)}%
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {totalPassed}/{totalTests} tests
        </div>
      </div>

      {/* Execution Time */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Time</div>
        <div className="text-2xl font-bold text-white">
          {executionTime.toFixed(0)}
          <span className="text-lg text-gray-400">ms</span>
        </div>
      </div>

      {/* Memory Used */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Memory</div>
        <div className="text-2xl font-bold text-white">
          {memoryUsed > 0
            ? `${(memoryUsed / 1024 / 1024).toFixed(1)}MB`
            : 'N/A'}
        </div>
      </div>

      {/* Status */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="text-gray-400 text-sm mb-1">Status</div>
        <div
          className={`text-xl font-bold ${
            passRate === 100 ? 'text-green-500' : 'text-yellow-500'
          }`}
        >
          {passRate === 100 ? 'Accepted' : 'Wrong Answer'}
        </div>
      </div>
    </div>
  );
}
