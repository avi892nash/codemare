import { Example } from '../../types/problem';

interface ProblemExamplesProps {
  examples: Example[];
}

export function ProblemExamples({ examples }: ProblemExamplesProps) {
  return (
    <div className="space-y-4">
      {examples.map((example, index) => (
        <div
          key={index}
          className="bg-gray-800 rounded-lg p-4 border border-gray-700"
        >
          <div className="mb-2">
            <span className="text-gray-400 font-semibold">Example {index + 1}</span>
          </div>

          <div className="mb-2">
            <div className="text-gray-400 text-sm mb-1">Input:</div>
            <code className="block bg-gray-900 rounded px-3 py-2 text-green-400 font-mono text-sm">
              {example.input}
            </code>
          </div>

          <div className="mb-2">
            <div className="text-gray-400 text-sm mb-1">Output:</div>
            <code className="block bg-gray-900 rounded px-3 py-2 text-blue-400 font-mono text-sm">
              {example.output}
            </code>
          </div>

          {example.explanation && (
            <div>
              <div className="text-gray-400 text-sm mb-1">Explanation:</div>
              <p className="text-gray-300 text-sm">{example.explanation}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
