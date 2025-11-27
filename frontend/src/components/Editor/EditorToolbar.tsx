import { LanguageSelector } from './LanguageSelector';
import { useEditor } from '../../context/EditorContext';

interface EditorToolbarProps {
  onRun: () => void;
  onReset: () => void;
}

export function EditorToolbar({ onRun, onReset }: EditorToolbarProps) {
  const { isExecuting, currentProblem } = useEditor();

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
      <div className="flex items-center gap-3">
        <LanguageSelector />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          disabled={!currentProblem || isExecuting}
          className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset Code
        </button>

        <button
          onClick={onRun}
          disabled={!currentProblem || isExecuting}
          className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
        >
          {isExecuting ? 'Running...' : 'Run Code'}
        </button>
      </div>
    </div>
  );
}
