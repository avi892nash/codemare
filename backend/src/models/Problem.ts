/**
 * One test as the harness generators (codeWrapperService) take it. runService
 * builds these from a /v1/run request's tests; `expectedOutput` is filled in
 * only for C++/Java, whose generated programs embed it as a typed literal
 * (null otherwise, so the answers never enter the sandbox).
 */
export interface TestCase {
  input: any[];
  expectedOutput: any;
  hidden: boolean;
}

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
 * Typed signature of the function under test. Required for C++, Java and Go
 * (their harness generators embed test inputs as typed literals); optional
 * for Python/JavaScript/TypeScript, whose harnesses are dynamically typed.
 */
export interface ProblemSignature {
  params: SignatureParam[];
  returns: SignatureType;
}
