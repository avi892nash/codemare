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
