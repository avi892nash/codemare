type Mode = 'problem' | 'ide';

interface NavbarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

export function Navbar({ mode, onModeChange }: NavbarProps) {
  return (
    <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Codemare</h1>
            <span className="text-sm text-gray-400">Online Code Editor</span>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1">
            <button
              onClick={() => onModeChange('problem')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'problem'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Problems
            </button>
            <button
              onClick={() => onModeChange('ide')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === 'ide'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              IDE
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-white transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}
