/**
 * Shared types for the web app. Mirrors the compile-service response shape
 * (kept identical so we never have to convert) plus the user-facing models
 * the database will host (User, Submission, etc. — populated in later commits).
 */

export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export type SandboxStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

export interface TestCase {
  input: unknown[];
  expectedOutput: unknown;
  hidden?: boolean;
}

export interface ProblemListItem {
  id: string;
  title: string;
  difficulty: Difficulty;
}

export interface Problem extends ProblemListItem {
  description: string;
  examples: Example[];
  constraints: string[];
  starterCode: Record<Language, string>;
  functionName: string;
  testCases: TestCase[];
}

export interface ExecutionRequest {
  problemId: string;
  language: Language;
  code: string;
}

export interface TestCaseResult {
  input: unknown[];
  expectedOutput: unknown;
  actualOutput: unknown;
  passed: boolean;
  executionTime: number;
  runMs?: number;
  wallMs?: number;
  memoryKb?: number;
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
  runMs?: number;
  wallMs?: number;
  memoryKb?: number;
  compileMs?: number;
  status?: SandboxStatus;
  error?: string;
}

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
  runMs?: number;
  wallMs?: number;
  memoryKb?: number;
  compileMs?: number;
  status?: SandboxStatus;
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
