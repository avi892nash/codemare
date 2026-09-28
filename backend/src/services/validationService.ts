import { LANGUAGES } from '../models/ExecutionResult.js';
import { CompareMode } from '../models/Problem.js';
import { RunStatus } from '../models/Run.js';
import { SandboxStatus } from './sandbox/types.js';

export interface DeepEqualOptions {
  /**
   * Numbers within this absolute difference are equal. Used for
   * double-returning signatures, matching the C++/Java harnesses' 1e-6.
   */
  floatTolerance?: number;
}

/**
 * Deep equality check for comparing outputs.
 *
 * With compareMode 'unordered', arrays are compared as multisets: both sides
 * are canonicalised — every array, innermost first, sorted by a canonical
 * key — before the element-wise deep-compare, so [1, 0] equals [0, 1] and
 * [[3, 1], [0, 2]] equals [[1, 3], [2, 0]]. (Children are canonicalised
 * before their parent is sorted, exactly like the harnesses do.)
 */
export function deepEqual(
  a: any,
  b: any,
  compareMode: CompareMode = 'ordered',
  options: DeepEqualOptions = {}
): boolean {
  if (compareMode === 'unordered') {
    return equalOrdered(canonicalize(a), canonicalize(b), options);
  }
  return equalOrdered(a, b, options);
}

function equalOrdered(a: any, b: any, options: DeepEqualOptions): boolean {
  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  if (
    options.floatTolerance !== undefined &&
    typeof a === 'number' &&
    typeof b === 'number'
  ) {
    return a === b || Math.abs(a - b) <= options.floatTolerance;
  }

  // Handle primitive types
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }

  // Handle arrays
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => equalOrdered(item, b[index], options));
  }

  // Handle objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && equalOrdered(a[key], b[key], options)
  );
}

/**
 * Recursively sort every array by a canonical key. Sorting both sides with
 * the same total order makes element-wise comparison equivalent to multiset
 * equality. An all-number array sorts numerically (so values within a float
 * tolerance line up); anything else sorts by the JSON of its canonical form.
 */
function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    if (items.every((v) => typeof v === 'number')) {
      return items.sort((x, y) => x - y);
    }
    const keyed = items.map((v) => ({ v, k: JSON.stringify(v) ?? '' }));
    keyed.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
    return keyed.map((e) => e.v);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * Derive the final judge verdict from the sandbox status and test outcomes.
 * The sandbox reports 'OK' whenever the process exits cleanly — a clean exit
 * with failing tests is a Wrong Answer ('WA', which the sandbox itself never
 * emits), not an accepted run. Real sandbox statuses (TLE/RE/CE/MLE/XX) pass
 * through untouched.
 */
export function deriveVerdict(
  sandboxStatus: SandboxStatus | undefined,
  totalPassed: number,
  totalTests: number
): RunStatus | undefined {
  if (sandboxStatus !== 'OK') return sandboxStatus;
  return totalPassed === totalTests ? 'OK' : 'WA';
}

/**
 * Validate IDE execution request
 */
export function validateIdeRequest(request: any): { valid: boolean; error?: string } {
  // Validate language
  if (!(LANGUAGES as readonly unknown[]).includes(request.language)) {
    return { valid: false, error: `Invalid language. Must be one of: ${LANGUAGES.join(', ')}` };
  }

  // Validate code
  if (!request.code || typeof request.code !== 'string') {
    return { valid: false, error: 'Code is required and must be a string' };
  }

  if (request.code.trim().length === 0) {
    return { valid: false, error: 'Code cannot be empty' };
  }

  if (request.code.length > 50000) {
    return { valid: false, error: 'Code exceeds maximum size of 50KB' };
  }

  // Validate test cases
  if (!Array.isArray(request.testCases)) {
    return { valid: false, error: 'Test cases must be an array' };
  }

  if (request.testCases.length === 0) {
    return { valid: false, error: 'At least one test case is required' };
  }

  if (request.testCases.length > 10) {
    return { valid: false, error: 'Maximum 10 test cases allowed' };
  }

  // Validate each test case
  for (let i = 0; i < request.testCases.length; i++) {
    const tc = request.testCases[i];

    if (typeof tc.input !== 'string') {
      return { valid: false, error: `Test ${i + 1}: input must be a string` };
    }

    if (typeof tc.expectedOutput !== 'string') {
      return { valid: false, error: `Test ${i + 1}: expectedOutput must be a string` };
    }

    if (tc.input.length > 10000) {
      return { valid: false, error: `Test ${i + 1}: input too large (max 10KB)` };
    }

    if (tc.expectedOutput.length > 100000) {
      return { valid: false, error: `Test ${i + 1}: expected output too large (max 100KB)` };
    }
  }

  return { valid: true };
}
