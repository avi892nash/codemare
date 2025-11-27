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

// IDE Execution Types
export interface IdeTestCase {
  input: string;
  expectedOutput: string;
}

export interface IdeExecutionRequest {
  code: string;
  language: Language;
  testCases: IdeTestCase[];
}

export interface IdeTestResult {
  input: string;
  expectedOutput: string;
  actualOutput: string;
  passed: boolean;
  executionTime: number;
  error?: string;
}

export interface IdeExecutionResponse {
  success: boolean;
  testResults: IdeTestResult[];
  totalPassed: number;
  totalTests: number;
  totalExecutionTime: number;
  error?: string;
}
