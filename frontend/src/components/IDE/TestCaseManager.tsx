import { useState } from 'react';
import { IdeTestCase } from '../../types/execution';

interface TestCaseManagerProps {
  testCases: IdeTestCase[];
  onTestCasesChange: (testCases: IdeTestCase[]) => void;
  maxTestCases?: number;
}

export function TestCaseManager({
  testCases,
  onTestCasesChange,
  maxTestCases = 10,
}: TestCaseManagerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const handleAddTestCase = () => {
    if (testCases.length >= maxTestCases) {
      alert(`Maximum ${maxTestCases} test cases allowed`);
      return;
    }
    const newTestCases = [
      ...testCases,
      { input: '', expectedOutput: '' },
    ];
    onTestCasesChange(newTestCases);
    setExpandedIndex(testCases.length);
  };

  const handleRemoveTestCase = (index: number) => {
    if (testCases.length <= 1) {
      alert('At least one test case is required');
      return;
    }
    const newTestCases = testCases.filter((_, i) => i !== index);
    onTestCasesChange(newTestCases);
    if (expandedIndex === index) {
      setExpandedIndex(0);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const handleTestCaseChange = (
    index: number,
    field: 'input' | 'expectedOutput',
    value: string
  ) => {
    const newTestCases = [...testCases];
    newTestCases[index] = { ...newTestCases[index], [field]: value };
    onTestCasesChange(newTestCases);
  };

  const toggleExpanded = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
        <h3 className="text-white font-semibold">
          Test Cases ({testCases.length}/{maxTestCases})
        </h3>
        <button
          onClick={handleAddTestCase}
          disabled={testCases.length >= maxTestCases}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + Add Test
        </button>
      </div>

      {/* Test Cases List */}
      <div className="flex-1 overflow-y-auto">
        {testCases.map((testCase, index) => (
          <div
            key={index}
            className="border-b border-gray-700"
          >
            {/* Test Case Header */}
            <div
              className="flex items-center justify-between px-4 py-2 bg-gray-800 hover:bg-gray-750 cursor-pointer"
              onClick={() => toggleExpanded(index)}
            >
              <span className="text-gray-300 text-sm font-medium">
                Test Case {index + 1}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveTestCase(index);
                  }}
                  className="px-2 py-1 text-red-400 hover:text-red-300 text-xs"
                >
                  Remove
                </button>
                <span className="text-gray-500">
                  {expandedIndex === index ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {/* Test Case Content */}
            {expandedIndex === index && (
              <div className="p-4 bg-gray-900 space-y-3">
                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Input (stdin)
                  </label>
                  <textarea
                    value={testCase.input}
                    onChange={(e) =>
                      handleTestCaseChange(index, 'input', e.target.value)
                    }
                    placeholder="Enter input data (e.g., 2 3)"
                    className="w-full px-3 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono text-sm"
                    rows={3}
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    Data to be sent to stdin
                  </p>
                </div>

                <div>
                  <label className="block text-gray-400 text-sm mb-1">
                    Expected Output (stdout)
                  </label>
                  <textarea
                    value={testCase.expectedOutput}
                    onChange={(e) =>
                      handleTestCaseChange(
                        index,
                        'expectedOutput',
                        e.target.value
                      )
                    }
                    placeholder="Enter expected output (e.g., 5)"
                    className="w-full px-3 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono text-sm"
                    rows={3}
                  />
                  <p className="text-gray-500 text-xs mt-1">
                    Expected output from stdout (exact match)
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
