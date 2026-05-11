import { useState } from 'react';
import { EditorProvider, useEditor } from './context/EditorContext';
import { Navbar } from './components/Layout/Navbar';
import { ProblemList } from './components/Problem/ProblemList';
import { ProblemDescription } from './components/Problem/ProblemDescription';
import { CodeEditor } from './components/Editor/CodeEditor';
import { EditorToolbar } from './components/Editor/EditorToolbar';
import { OutputDisplay } from './components/Results/OutputDisplay';
import { IdeView } from './components/IDE/IdeView';
import { DesignSystemPage } from './components/DesignSystem/DesignSystemPage';
import { AuthPage } from './components/Auth/AuthPage';
import { useCodeExecution } from './hooks/useCodeExecution';

function AppContent() {
  const {
    mode,
    setMode,
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
    <div
      className="cm"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
      }}
    >
      <Navbar mode={mode} onModeChange={setMode} />

      {mode === 'problem' ? (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Left — Problem catalog */}
          {showProblemList && (
            <div style={{ width: 280, flex: 'none', borderRight: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
              <ProblemList />
            </div>
          )}

          {/* Middle — Problem description */}
          <div style={{ width: 460, flex: 'none', borderRight: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
            <ProblemDescription />
          </div>

          {/* Right — Editor + Results */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <EditorToolbar onRun={handleRun} onReset={handleReset} />
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <CodeEditor />
            </div>
            <div style={{ height: '50%', borderTop: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
              <OutputDisplay results={executionResults} />
            </div>
          </div>
        </div>
      ) : mode === 'ide' ? (
        <IdeView />
      ) : mode === 'design' ? (
        <DesignSystemPage />
      ) : (
        <AuthPage />
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
