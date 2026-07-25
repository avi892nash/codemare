export interface TestCase {
  input: any[];
  expectedOutput: any;
  hidden: boolean; // Hidden test cases not shown to user
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

/**
 * How the judge compares actual output against expected output.
 *   'ordered'   — element order matters (default when omitted)
 *   'unordered' — array results are compared as multisets (both sides are
 *                 sorted before deep-compare), for problems that say
 *                 "you can return the answer in any order"
 */
export type CompareMode = 'ordered' | 'unordered';

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  description: string;
  examples: Example[];
  constraints: string[];
  testCases: TestCase[];
  starterCode: StarterCode;
  functionName: string; // e.g., "twoSum", "reverseString"
  compareMode?: CompareMode; // defaults to 'ordered' when omitted
}

export interface ProblemListItem {
  id: string;
  title: string;
  difficulty: Difficulty;
}
