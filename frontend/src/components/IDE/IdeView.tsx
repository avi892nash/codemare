import { useState, useEffect } from 'react';
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

export function IdeView() {
  const { selectedLanguage, code, setCode, mode } = useEditor();
  const [testCases, setTestCases] = useState<IdeTestCase[]>([
    { input: '2\n3', expectedOutput: '5' },
  ]);
  const [ideResults, setIdeResults] = useState<IdeExecutionResponse | null>(
    null
  );
  const [isExecuting, setIsExecuting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize with template code when entering IDE mode for the first time
  useEffect(() => {
    if (mode === 'ide' && !initialized) {
      setCode(IDE_TEMPLATES[selectedLanguage]);
      setInitialized(true);
    }
  }, [mode, initialized, selectedLanguage, setCode]);

  // Update template when language changes in IDE mode
  useEffect(() => {
    if (mode === 'ide' && initialized) {
      setCode(IDE_TEMPLATES[selectedLanguage]);
    }
  }, [selectedLanguage]);

  const handleRun = async () => {
    // Validate test cases
    const hasEmptyTestCase = testCases.some(
      (tc) => !tc.input.trim() && !tc.expectedOutput.trim()
    );
    if (hasEmptyTestCase && testCases.length === 1) {
      alert(
        'Please add at least one test case with input or expected output'
      );
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
        error:
          error.response?.data?.error ||
          error.message ||
          'Execution failed. Please try again.',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = () => {
    setCode(IDE_TEMPLATES[selectedLanguage]);
    setIdeResults(null);
    setTestCases([{ input: '2\n3', expectedOutput: '5' }]);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left - Test Cases */}
      <div className="w-80 border-r border-gray-700 overflow-hidden">
        <TestCaseManager
          testCases={testCases}
          onTestCasesChange={setTestCases}
        />
      </div>

      {/* Middle - Code Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <h2 className="text-white font-semibold">IDE Mode</h2>
            <LanguageSelector />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={isExecuting}
              className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>

            <button
              onClick={handleRun}
              disabled={isExecuting}
              className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
            >
              {isExecuting ? 'Running...' : 'Run Code'}
            </button>
          </div>
        </div>

        {/* Code Editor */}
        <div className="flex-1 overflow-hidden">
          <CodeEditor />
        </div>

        {/* Results Panel */}
        <div className="h-1/2 border-t border-gray-700 overflow-hidden">
          <IdeOutputDisplay results={ideResults} />
        </div>
      </div>
    </div>
  );
}
