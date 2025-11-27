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
  executionTime: number; // milliseconds
  error?: string;
  hidden?: boolean;
}

export interface ExecutionResponse {
  success: boolean;
  testResults: TestCaseResult[];
  totalPassed: number;
  totalTests: number;
  executionTime: number; // total execution time in ms
  memoryUsed: number; // in bytes
  error?: string; // compilation or runtime error
}

export interface DockerExecutionInput {
  code: string;
  tests: {
    input: any[];
    expected: any;
  }[];
  functionName: string;
}

export interface DockerExecutionOutput {
  results?: {
    output: any;
    expected: any;
    passed: boolean;
    error?: string;
  }[];
  error?: string;
  traceback?: string;
}
