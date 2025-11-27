import { useEditor } from '../../context/EditorContext';
import { ProblemExamples } from './ProblemExamples';

const DIFFICULTY_COLORS = {
  Easy: 'bg-green-500',
  Medium: 'bg-yellow-500',
  Hard: 'bg-red-500',
};

export function ProblemDescription() {
  const { currentProblem } = useEditor();

  if (!currentProblem) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-center">
          <p className="text-xl mb-2">No problem selected</p>
          <p className="text-sm">Select a problem from the list to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 bg-gray-900">
      {/* Title and Difficulty */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-white">{currentProblem.title}</h1>
          <span
            className={`px-3 py-1 rounded-full text-sm font-semibold text-white ${
              DIFFICULTY_COLORS[currentProblem.difficulty]
            }`}
          >
            {currentProblem.difficulty}
          </span>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-3">Description</h2>
        <div className="text-gray-300 leading-relaxed whitespace-pre-wrap">
          {currentProblem.description}
        </div>
      </div>

      {/* Examples */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-3">Examples</h2>
        <ProblemExamples examples={currentProblem.examples} />
      </div>

      {/* Constraints */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-white mb-3">Constraints</h2>
        <ul className="list-disc list-inside space-y-2 text-gray-300">
          {currentProblem.constraints.map((constraint, index) => (
            <li key={index} className="font-mono text-sm">
              {constraint}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
