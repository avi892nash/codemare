import { useState } from 'react';
import { CodeEditor } from '../Editor/CodeEditor';
import { LanguageSelector } from '../Editor/LanguageSelector';
import { TestCaseManager } from './TestCaseManager';
import { IdeOutputDisplay } from './IdeOutputDisplay';
import { useEditor } from '../../context/EditorContext';
import { ideExecutionApi } from '../../services/api';
import {
  IdeTestCase,
  IdeExecutionResponse,
} from '../../types/execution';
import { IDE_TEMPLATES } from '../../constants/ideTemplates';
import { useIdePersistence } from '../../hooks/useIdePersistence';
import { clearLanguageData } from '../../utils/localStorage';
import { Button, Pill } from '../ui/primitives';

export function IdeView() {
  const { selectedLanguage, code, setCode, mode } = useEditor();
  const [testCases, setTestCases] = useState<IdeTestCase[]>([
    { input: '2\n3', expectedOutput: '5' },
  ]);
  const [ideResults, setIdeResults] = useState<IdeExecutionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  useIdePersistence(selectedLanguage, code, setCode, testCases, setTestCases, mode);

  const handleRun = async () => {
    const hasEmptyTestCase = testCases.some(
      (tc) => !tc.input.trim() && !tc.expectedOutput.trim()
    );
    if (hasEmptyTestCase && testCases.length === 1) {
      alert('Please add at least one test case with input or expected output');
      return;
    }

    if (!code.trim()) {
      alert('Please write some code before running');
      return;
    }

    try {
      setIsExecuting(true);
      setIdeResults(null);
      const result = await ideExecutionApi.execute({
        code,
        language: selectedLanguage,
        testCases: testCases.filter(
          (tc) => tc.input.trim() || tc.expectedOutput.trim()
        ),
      });
      setIdeResults(result);
    } catch (error: any) {
      console.error('IDE execution failed:', error);
      setIdeResults({
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: 0,
        totalExecutionTime: 0,
        error: error.response?.data?.error ?? error.message ?? 'Execution failed. Please try again.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    clearLanguageData(selectedLanguage);
    setCode(IDE_TEMPLATES[selectedLanguage]);
    setIdeResults(null);
    setTestCases([{ input: '2\n3', expectedOutput: '5' }]);
  };

  return (
    <div className="cm" style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, background: 'var(--bg-0)' }}>
      <div style={{ width: 320, flex: 'none', borderRight: '1px solid var(--line-2)', overflow: 'hidden' }}>
        <TestCaseManager testCases={testCases} onTestCasesChange={setTestCases} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '8px 14px',
          background: 'var(--bg-1)', borderBottom: '1px solid var(--line-2)',
          flex: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill tone="accent" size="sm">IDE</Pill>
            <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>Free-form playground · custom stdin/stdout</span>
            <span style={{ width: 1, height: 18, background: 'var(--line-2)', margin: '0 4px' }} />
            <LanguageSelector />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant="ghost" size="sm" icon="refresh" onClick={handleReset} disabled={isExecuting}>
              Reset
            </Button>
            <Button variant="primary" size="md" icon="play" onClick={handleRun} disabled={isExecuting} kbd="⌘ ↵">
              {isExecuting ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <CodeEditor />
        </div>

        <div style={{ height: '50%', borderTop: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
          <IdeOutputDisplay results={ideResults} />
        </div>
      </div>
    </div>
  );
}
