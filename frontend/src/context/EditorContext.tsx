import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { Problem } from '../types/problem';
import { Language, ExecutionResponse } from '../types/execution';
import { useAppPersistence, useAppStateRestoration } from '../hooks/useAppPersistence';
import { getProblemCode } from '../utils/localStorage';
import { problemsApi } from '../services/api';

type Mode = 'problem' | 'ide';

interface EditorContextType {
  // Current mode
  mode: Mode;
  setMode: (mode: Mode) => void;

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
  // Restore persisted app state
  const persistedState = useAppStateRestoration();

  const [mode, setMode] = useState<Mode>(persistedState?.mode || 'problem');
  const [currentProblem, setCurrentProblem] = useState<Problem | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    persistedState?.selectedLanguage || 'python'
  );
  const [code, setCode] = useState<string>('');
  const [executionResults, setExecutionResults] = useState<ExecutionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // Persist app state changes
  useAppPersistence(
    mode,
    selectedLanguage,
    currentProblem?.id || null,
    code
  );

  // Restore problem on mount if we have a persisted problem ID
  useEffect(() => {
    if (persistedState?.currentProblemId && !currentProblem) {
      problemsApi.getById(persistedState.currentProblemId)
        .then((problem) => {
          setCurrentProblem(problem);
        })
        .catch((error) => {
          console.error('Failed to restore problem:', error);
        });
    }
  }, []); // Run only on mount

  // Restore problem code when problem or language changes (in problem mode)
  useEffect(() => {
    if (mode === 'problem' && currentProblem) {
      const savedCode = getProblemCode(currentProblem.id, selectedLanguage);
      if (savedCode) {
        setCode(savedCode);
      } else {
        // Use starter code if no saved code
        setCode(currentProblem.starterCode[selectedLanguage]);
      }
    }
  }, [currentProblem, selectedLanguage, mode]);

  return (
    <EditorContext.Provider
      value={{
        mode,
        setMode,
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
