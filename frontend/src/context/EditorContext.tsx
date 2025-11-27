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
