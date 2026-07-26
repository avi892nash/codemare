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

/**
 * Scalar types a problem signature may use. Arrays are expressed with `[]`
 * (one-dimensional) or `[][]` (two-dimensional) suffixes, e.g. "int[]",
 * "string[]", "int[][]".
 *
 * Note: `int`/`long` map to int / long long in C++ and int / long in Java;
 * `double` results are compared with an absolute tolerance of 1e-6 by the
 * generated C++/Java harnesses.
 */
export type SignatureBaseType =
  | 'int'
  | 'long'
  | 'double'
  | 'bool'
  | 'string'
  | 'char';

export type SignatureType =
  | SignatureBaseType
  | `${SignatureBaseType}[]`
  | `${SignatureBaseType}[][]`;

export interface SignatureParam {
  name: string;
  type: SignatureType;
}

/**
 * Typed function signature for the problem. Required for C++/Java Problems
 * mode (the harness generator embeds test inputs as typed literals); optional
 * for Python/JavaScript, whose harnesses are dynamically typed.
 */
export interface ProblemSignature {
  params: SignatureParam[];
  returns: SignatureType;
}

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
  signature?: ProblemSignature; // required for C++/Java Problems mode
}

export interface ProblemListItem {
  id: string;
  title: string;
  difficulty: Difficulty;
}
