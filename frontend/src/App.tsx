import { useState } from 'react';
import { EditorProvider, useEditor } from './context/EditorContext';
import { Navbar } from './components/Layout/Navbar';
import { ProblemList } from './components/Problem/ProblemList';
import { ProblemDescription } from './components/Problem/ProblemDescription';
import { CodeEditor } from './components/Editor/CodeEditor';
import { EditorToolbar } from './components/Editor/EditorToolbar';
import { OutputDisplay } from './components/Results/OutputDisplay';
import { IdeView } from './components/IDE/IdeView';
import { useCodeExecution } from './hooks/useCodeExecution';

type Mode = 'problem' | 'ide';

function AppContent() {
  const {
    currentProblem,
    selectedLanguage,
    code,
    setCode,
    executionResults,
    setExecutionResults,
    setIsExecuting,
  } = useEditor();

  const { executeCode } = useCodeExecution();
  const [showProblemList] = useState(true);
  const [mode, setMode] = useState<Mode>('problem');

  const handleRun = async () => {
    if (!currentProblem) return;

    try {
      setIsExecuting(true);
      const result = await executeCode({
        problemId: currentProblem.id,
        language: selectedLanguage,
        code,
      });
      setExecutionResults(result);
    } catch (error) {
      console.error('Execution failed:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    if (currentProblem) {
      setCode(currentProblem.starterCode[selectedLanguage]);
      setExecutionResults(null);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <Navbar mode={mode} onModeChange={setMode} />

      {mode === 'problem' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Problem List */}
          {showProblemList && (
            <div className="w-80 border-r border-gray-700 overflow-y-auto bg-gray-900">
              <ProblemList />
            </div>
          )}

          {/* Middle - Problem Description */}
          <div className="w-1/3 border-r border-gray-700 overflow-hidden">
            <ProblemDescription />
          </div>

          {/* Right - Code Editor + Results */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Editor Toolbar */}
            <EditorToolbar onRun={handleRun} onReset={handleReset} />

            {/* Code Editor */}
            <div className="flex-1 overflow-hidden">
              <CodeEditor />
            </div>

            {/* Results Panel */}
            <div className="h-1/2 border-t border-gray-700 overflow-hidden">
              <OutputDisplay results={executionResults} />
            </div>
          </div>
        </div>
      ) : (
        <IdeView />
      )}
    </div>
  );
}

function App() {
  return (
    <EditorProvider>
      <AppContent />
    </EditorProvider>
  );
}

export default App;
