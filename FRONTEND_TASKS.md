# Frontend Tasks Breakdown

## Current Status: ⏳ 30% Complete (Scaffolded, Needs Implementation)

The frontend has the basic Vite + React + TypeScript setup. All UI components and functionality need to be built.

---

## Core Implementation Tasks (Required for MVP)

### Phase 1: Foundation & Types

#### Task F1: TypeScript Type Definitions (Priority: Critical)

**Estimated Time:** 30 minutes

Mirror backend types in frontend for type safety.

**File:** `frontend/src/types/problem.ts`
```typescript
export interface TestCase {
  input: any[];
  expectedOutput: any;
  hidden: boolean;
}

export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

export interface StarterCode {
  python: string;
  javascript: string;
  cpp: string;
  java: string;
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  examples: Example[];
  constraints: string[];
  testCases: TestCase[];
  starterCode: StarterCode;
  functionName: string;
}

export interface ProblemListItem {
  id: string;
  title: string;
  difficulty: Difficulty;
}
```

**File:** `frontend/src/types/execution.ts`
```typescript
export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export interface ExecutionRequest {
  problemId: string;
  language: Language;
  code: string;
}

export interface TestCaseResult {
  input: any[];
  expectedOutput: any;
  actualOutput: any;
  passed: boolean;
  executionTime: number;
  error?: string;
  hidden?: boolean;
}

export interface ExecutionResponse {
  success: boolean;
  testResults: TestCaseResult[];
  totalPassed: number;
  totalTests: number;
  executionTime: number;
  memoryUsed: number;
  error?: string;
}
```

---

#### Task F2: API Client Service (Priority: Critical)

**Estimated Time:** 1 hour

Create centralized API client with Axios.

**File:** `frontend/src/services/api.ts`

**Subtasks:**

**F2.1: Create Axios Instance**
```typescript
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);
```

**F2.2: API Functions**
```typescript
import { Problem, ProblemListItem } from '../types/problem';
import { ExecutionRequest, ExecutionResponse } from '../types/execution';

export const problemsApi = {
  // Get all problems
  getAll: async (): Promise<ProblemListItem[]> => {
    const response = await apiClient.get('/api/problems');
    return response.data.problems;
  },

  // Get specific problem
  getById: async (id: string): Promise<Problem> => {
    const response = await apiClient.get(`/api/problems/${id}`);
    return response.data.problem;
  },
};

export const executionApi = {
  // Execute code
  execute: async (request: ExecutionRequest): Promise<ExecutionResponse> => {
    const response = await apiClient.post('/api/execute', request);
    return response.data;
  },
};
```

**F2.3: Create Environment File**
**File:** `frontend/.env`
```env
VITE_API_URL=http://localhost:3000
```

---

#### Task F3: React Context for Global State (Priority: High)

**Estimated Time:** 1 hour

Create context to share state across components.

**File:** `frontend/src/context/EditorContext.tsx`

```typescript
import { createContext, useContext, useState, ReactNode } from 'react';
import { Problem } from '../types/problem';
import { Language, ExecutionResponse } from '../types/execution';

interface EditorContextType {
  // Current problem
  currentProblem: Problem | null;
  setCurrentProblem: (problem: Problem | null) => void;

  // Selected language
  selectedLanguage: Language;
  setSelectedLanguage: (language: Language) => void;

  // Code editor content
  code: string;
  setCode: (code: string) => void;

  // Execution results
  executionResults: ExecutionResponse | null;
  setExecutionResults: (results: ExecutionResponse | null) => void;

  // Loading states
  isExecuting: boolean;
  setIsExecuting: (isExecuting: boolean) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('python');
  const [code, setCode] = useState<string>('');
  const [executionResults, setExecutionResults] = useState<ExecutionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  return (
    <EditorContext.Provider
      value={{
        currentProblem,
        setCurrentProblem,
        selectedLanguage,
        setSelectedLanguage,
        code,
        setCode,
        executionResults,
        setExecutionResults,
        isExecuting,
        setIsExecuting,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within EditorProvider');
  }
  return context;
}
```

**Update:** `frontend/src/App.tsx`
```typescript
import { EditorProvider } from './context/EditorContext';

function App() {
  return (
    <EditorProvider>
      {/* App content will go here */}
    </EditorProvider>
  );
}
```

---

### Phase 2: Monaco Editor Integration

#### Task F4: Monaco Editor Component (Priority: Critical)

**Estimated Time:** 2 hours

Integrate Monaco Editor with language support and theming.

**File:** `frontend/src/components/Editor/CodeEditor.tsx`

**Subtasks:**

**F4.1: Basic Editor Setup**
```typescript
import { useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import { useEditor } from '../../context/EditorContext';

const LANGUAGE_MAP: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  java: 'java',
};

export function CodeEditor() {
  const { code, setCode, selectedLanguage, currentProblem } = useEditor();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: currentProblem?.language === 'python' ? 4 : 2,
    });

    // Focus editor
    editor.focus();
  };

  const handleCodeChange = (value: string | undefined) => {
    setCode(value || '');
  };

  // Load starter code when problem or language changes
  useEffect(() => {
    if (currentProblem) {
      const starterCode = currentProblem.starterCode[selectedLanguage];
      setCode(starterCode);
    }
  }, [currentProblem, selectedLanguage]);

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={LANGUAGE_MAP[selectedLanguage]}
        value={code}
        onChange={handleCodeChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          selectOnLineNumbers: true,
          roundedSelection: false,
          readOnly: false,
          cursorStyle: 'line',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
```

**F4.2: Add Keyboard Shortcuts**
```typescript
// Inside handleEditorDidMount
editor.addCommand(
  monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
  () => {
    // Trigger code execution
    // We'll implement this in Task F7
    console.log('Run code (Ctrl+Enter)');
  }
);
```

---

#### Task F5: Language Selector Component (Priority: High)

**Estimated Time:** 30 minutes

Dropdown to switch between programming languages.

**File:** `frontend/src/components/Editor/LanguageSelector.tsx`

```typescript
import { useEditor } from '../../context/EditorContext';
import type { Language } from '../../types/execution';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
];

export function LanguageSelector() {
  const { selectedLanguage, setSelectedLanguage } = useEditor();

  return (
    <select
      value={selectedLanguage}
      onChange={(e) => setSelectedLanguage(e.target.value as Language)}
      className="px-4 py-2 bg-gray-800 text-white rounded-md border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang.value} value={lang.value}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
```

---

#### Task F6: Editor Toolbar Component (Priority: High)

**Estimated Time:** 45 minutes

Toolbar with Run, Reset, and language selector.

**File:** `frontend/src/components/Editor/EditorToolbar.tsx`

```typescript
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
```

---

### Phase 3: Problem Components

#### Task F7: Problem List Component (Priority: High)

**Estimated Time:** 1.5 hours

Display list of available problems.

**File:** `frontend/src/components/Problem/ProblemList.tsx`

```typescript
import { useState, useEffect } from 'react';
import { problemsApi } from '../../services/api';
import { ProblemListItem, Difficulty } from '../../types/problem';
import { useEditor } from '../../context/EditorContext';

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  Easy: 'text-green-500',
  Medium: 'text-yellow-500',
  Hard: 'text-red-500',
};

export function ProblemList() {
  const [problems, setProblems] = useState<ProblemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentProblem, setCurrentProblem } = useEditor();

  useEffect(() => {
    loadProblems();
  }, []);

  const loadProblems = async () => {
    try {
      setLoading(true);
      const data = await problemsApi.getAll();
      setProblems(data);
      setError(null);
    } catch (err) {
      setError('Failed to load problems');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleProblemClick = async (problemId: string) => {
    try {
      const problem = await problemsApi.getById(problemId);
      setCurrentProblem(problem);
    } catch (err) {
      console.error('Failed to load problem:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading problems...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold text-white mb-4">Problems</h2>
      <div className="space-y-2">
        {problems.map((problem) => (
          <div
            key={problem.id}
            onClick={() => handleProblemClick(problem.id)}
            className={`p-4 rounded-lg cursor-pointer transition-colors ${
              currentProblem?.id === problem.id
                ? 'bg-blue-900 border-2 border-blue-500'
                : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">{problem.title}</h3>
              <span className={`text-sm font-semibold ${DIFFICULTY_COLORS[problem.difficulty]}`}>
                {problem.difficulty}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

#### Task F8: Problem Description Component (Priority: High)

**Estimated Time:** 1 hour

Display problem details, examples, and constraints.

**File:** `frontend/src/components/Problem/ProblemDescription.tsx`

```typescript
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
```

---

#### Task F9: Problem Examples Component (Priority: Medium)

**Estimated Time:** 30 minutes

Display example inputs and outputs.

**File:** `frontend/src/components/Problem/ProblemExamples.tsx`

```typescript
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
```

---

### Phase 4: Results Components

#### Task F10: Test Case Results Component (Priority: Critical)

**Estimated Time:** 1.5 hours

Display test case results with pass/fail indicators.

**File:** `frontend/src/components/Results/TestCaseResults.tsx`

```typescript
import { TestCaseResult } from '../../types/execution';

interface TestCaseResultsProps {
  results: TestCaseResult[];
}

export function TestCaseResults({ results }: TestCaseResultsProps) {
  return (
    <div className="space-y-3">
      {results.map((result, index) => (
        <div
          key={index}
          className={`rounded-lg p-4 border-2 ${
            result.passed
              ? 'bg-green-900/20 border-green-600'
              : 'bg-red-900/20 border-red-600'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`text-2xl ${
                  result.passed ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {result.passed ? '✓' : '✗'}
              </span>
              <span className="font-semibold text-white">
                {result.hidden ? 'Hidden Test Case' : `Test Case ${index + 1}`}
              </span>
            </div>
            <span className="text-sm text-gray-400">
              {result.executionTime.toFixed(2)}ms
            </span>
          </div>

          {!result.hidden && (
            <>
              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Input:</div>
                <code className="block bg-gray-900 rounded px-3 py-2 text-gray-300 font-mono text-sm">
                  {JSON.stringify(result.input)}
                </code>
              </div>

              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Expected:</div>
                <code className="block bg-gray-900 rounded px-3 py-2 text-green-400 font-mono text-sm">
                  {JSON.stringify(result.expectedOutput)}
                </code>
              </div>

              <div className="mb-2">
                <div className="text-sm text-gray-400 mb-1">Your Output:</div>
                <code
                  className={`block bg-gray-900 rounded px-3 py-2 font-mono text-sm ${
                    result.passed ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {JSON.stringify(result.actualOutput)}
                </code>
              </div>
            </>
          )}

          {result.error && (
            <div className="mt-2">
              <div className="text-sm text-red-400 mb-1">Error:</div>
              <code className="block bg-red-900/30 rounded px-3 py-2 text-red-300 font-mono text-sm">
                {result.error}
              </code>
            </div>
          )}

          {result.hidden && (
            <div className="text-sm text-gray-400 italic">
              {result.passed
                ? 'Passed hidden test case ✓'
                : 'Failed hidden test case ✗'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

#### Task F11: Output Display Component (Priority: High)

**Estimated Time:** 45 minutes

Display execution output, errors, and summary.

**File:** `frontend/src/components/Results/OutputDisplay.tsx`

```typescript
import { ExecutionResponse } from '../../types/execution';
import { TestCaseResults } from './TestCaseResults';
import { ExecutionStats } from './ExecutionStats';

interface OutputDisplayProps {
  results: ExecutionResponse | null;
}

export function OutputDisplay({ results }: OutputDisplayProps) {
  if (!results) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900">
        <div className="text-gray-400 text-center">
          <p className="text-lg mb-2">No results yet</p>
          <p className="text-sm">Run your code to see the results</p>
        </div>
      </div>
    );
  }

  if (results.error) {
    return (
      <div className="p-6 bg-gray-900 h-full overflow-y-auto">
        <div className="bg-red-900/20 border-2 border-red-600 rounded-lg p-4">
          <h3 className="text-xl font-semibold text-red-500 mb-3">Error</h3>
          <pre className="text-red-300 font-mono text-sm whitespace-pre-wrap">
            {results.error}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-900 h-full overflow-y-auto">
      {/* Success/Failure Banner */}
      <div
        className={`rounded-lg p-4 mb-6 border-2 ${
          results.success
            ? 'bg-green-900/20 border-green-600'
            : 'bg-yellow-900/20 border-yellow-600'
        }`}
      >
        <h2
          className={`text-2xl font-bold ${
            results.success ? 'text-green-500' : 'text-yellow-500'
          }`}
        >
          {results.success ? 'All Tests Passed! 🎉' : 'Some Tests Failed'}
        </h2>
        <p className="text-gray-300 mt-2">
          {results.totalPassed} / {results.totalTests} test cases passed
        </p>
      </div>

      {/* Execution Stats */}
      <ExecutionStats
        totalPassed={results.totalPassed}
        totalTests={results.totalTests}
        executionTime={results.executionTime}
        memoryUsed={results.memoryUsed}
      />

      {/* Test Results */}
      <div className="mt-6">
        <h3 className="text-xl font-semibold text-white mb-4">Test Results</h3>
        <TestCaseResults results={results.testResults} />
      </div>
    </div>
  );
}
```

---

#### Task F12: Execution Stats Component (Priority: Medium)

**Estimated Time:** 30 minutes

Display execution metrics (time, memory, pass rate).

**File:** `frontend/src/components/Results/ExecutionStats.tsx`

```typescript
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
```

---

### Phase 5: Layout & Integration

#### Task F13: Navbar Component (Priority: Medium)

**Estimated Time:** 30 minutes

Simple navigation bar with branding.

**File:** `frontend/src/components/Layout/Navbar.tsx`

```typescript
export function Navbar() {
  return (
    <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Codemare</h1>
          <span className="text-sm text-gray-400">Online Code Editor</span>
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
```

---

#### Task F14: Custom Hooks (Priority: High)

**Estimated Time:** 1 hour

Create hooks for common operations.

**File:** `frontend/src/hooks/useProblem.ts`

```typescript
import { useState, useEffect } from 'react';
import { problemsApi } from '../services/api';
import { Problem } from '../types/problem';

export function useProblem(problemId: string | null) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!problemId) {
      setProblem(null);
      return;
    }

    const loadProblem = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await problemsApi.getById(problemId);
        setProblem(data);
      } catch (err) {
        setError('Failed to load problem');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadProblem();
  }, [problemId]);

  return { problem, loading, error };
}
```

**File:** `frontend/src/hooks/useCodeExecution.ts`

```typescript
import { useState } from 'react';
import { executionApi } from '../services/api';
import { ExecutionRequest, ExecutionResponse } from '../types/execution';

export function useCodeExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<ExecutionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeCode = async (request: ExecutionRequest) => {
    try {
      setIsExecuting(true);
      setError(null);
      const response = await executionApi.execute(request);
      setResults(response);
      return response;
    } catch (err) {
      const errorMessage = 'Failed to execute code';
      setError(errorMessage);
      console.error(err);
      throw err;
    } finally {
      setIsExecuting(false);
    }
  };

  const clearResults = () => {
    setResults(null);
    setError(null);
  };

  return { executeCode, isExecuting, results, error, clearResults };
}
```

---

#### Task F15: Main App Layout (Priority: Critical)

**Estimated Time:** 2 hours

Integrate all components into the main app.

**File:** `frontend/src/App.tsx`

```typescript
import { useState } from 'react';
import { EditorProvider, useEditor } from './context/EditorContext';
import { Navbar } from './components/Layout/Navbar';
import { ProblemList } from './components/Problem/ProblemList';
import { ProblemDescription } from './components/Problem/ProblemDescription';
import { CodeEditor } from './components/Editor/CodeEditor';
import { EditorToolbar } from './components/Editor/EditorToolbar';
import { OutputDisplay } from './components/Results/OutputDisplay';
import { useCodeExecution } from './hooks/useCodeExecution';

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

  const { executeCode, isExecuting } = useCodeExecution();
  const [showProblemList, setShowProblemList] = useState(true);

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
      <Navbar />

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
```

---

### Phase 6: Polish & UX

#### Task F16: Loading States & Spinners (Priority: Medium)

**Estimated Time:** 45 minutes

Add loading indicators throughout the app.

**File:** `frontend/src/components/common/LoadingSpinner.tsx`

```typescript
export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex items-center justify-center">
      <div
        className={`${sizeClasses[size]} border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin`}
      />
    </div>
  );
}
```

Use in components that have loading states.

---

#### Task F17: Error Handling & Toast Notifications (Priority: Medium)

**Estimated Time:** 1 hour

Add user-friendly error messages.

Install a toast library:
```bash
npm install react-hot-toast
```

**File:** `frontend/src/utils/toast.ts`

```typescript
import toast from 'react-hot-toast';

export const showSuccess = (message: string) => {
  toast.success(message, {
    duration: 3000,
    position: 'top-right',
  });
};

export const showError = (message: string) => {
  toast.error(message, {
    duration: 4000,
    position: 'top-right',
  });
};

export const showLoading = (message: string) => {
  return toast.loading(message, {
    position: 'top-right',
  });
};
```

Add to App.tsx:
```typescript
import { Toaster } from 'react-hot-toast';

// Inside App component
<Toaster />
```

---

#### Task F18: Code Persistence (Priority: Low)

**Estimated Time:** 45 minutes

Save code to localStorage to prevent loss on refresh.

**File:** `frontend/src/hooks/useLocalStorage.ts`

```typescript
import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue] as const;
}
```

Use in EditorContext to persist code per problem.

---

#### Task F19: Responsive Design (Priority: Medium)

**Estimated Time:** 1.5 hours

Make the app work on tablets and mobile devices.

**Subtasks:**
- Add mobile menu for problem list
- Stack layout vertically on small screens
- Adjust font sizes and spacing
- Test on different screen sizes

---

#### Task F20: Keyboard Shortcuts (Priority: Low)

**Estimated Time:** 30 minutes

Add helpful keyboard shortcuts.

**Shortcuts:**
- `Ctrl/Cmd + Enter` - Run code
- `Ctrl/Cmd + R` - Reset code
- `Esc` - Close modals/panels

Implement using `useEffect` with event listeners.

---

## Task Completion Order (Recommended)

### Week 1: Core Functionality (MVP)

**Day 1:** Foundation
1. F1: Type Definitions (30m)
2. F2: API Client (1h)
3. F3: React Context (1h)

**Day 2:** Editor
4. F4: Monaco Editor (2h)
5. F5: Language Selector (30m)
6. F6: Editor Toolbar (45m)

**Day 3:** Problems
7. F7: Problem List (1.5h)
8. F8: Problem Description (1h)
9. F9: Problem Examples (30m)

**Day 4:** Results
10. F10: Test Case Results (1.5h)
11. F11: Output Display (45m)
12. F12: Execution Stats (30m)

**Day 5:** Integration
13. F14: Custom Hooks (1h)
14. F15: Main App Layout (2h)
15. F13: Navbar (30m)

### Week 2: Polish & Enhancements

**Day 6-7:** Polish
16. F16: Loading States (45m)
17. F17: Error Handling (1h)
18. F19: Responsive Design (1.5h)
19. F18: Code Persistence (45m)
20. F20: Keyboard Shortcuts (30m)

---

## Estimated Time Summary

**Core Features (F1-F15):** ~16 hours
**Polish & UX (F16-F20):** ~5 hours

**Total Frontend Development: ~21 hours**

**MVP (Required for basic functionality):** ~16 hours
**Nice-to-Have (Can be done later):** ~5 hours

---

## Testing Checklist

After each phase:

- [ ] TypeScript compiles without errors
- [ ] All components render without errors
- [ ] API calls work correctly
- [ ] State updates properly
- [ ] UI is responsive and intuitive
- [ ] Code execution works end-to-end
- [ ] Error handling works
- [ ] No console errors

---

## Dependencies to Install

```bash
cd frontend

# Already installed
# - react, react-dom
# - @monaco-editor/react
# - axios
# - tailwindcss

# Need to install
npm install react-hot-toast  # Task F17
```

---

## Environment Variables

Create `frontend/.env`:
```env
VITE_API_URL=http://localhost:3000
```

---

**Status:** Frontend ready for implementation
**Next Step:** Start with F1 (Type Definitions) and work through tasks sequentially
