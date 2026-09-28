// Question fixtures for the wrapper suites: the platform's real content, read
// from the web app's seed (web/prisma/seed/data/questions/<slug>.json, spec
// §6.1) and adapted from its snake_case shape to what wrapFunctionCode takes.
// Several carry the large hidden tests (10k-element arrays, a 20k-character
// string) that the javac and go build suites exist to prove.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompareMode, ProblemSignature, TestCase } from '../../src/models/Problem.js';

const QUESTIONS_DIR = fileURLToPath(new URL('../../../web/prisma/seed/data/questions', import.meta.url));

interface SeedQuestion {
  function_name: string;
  signature: ProblemSignature;
  compare_mode?: CompareMode;
  starter_code: Record<string, string>;
  tests: Array<{ input: unknown[]; expected: unknown; hidden?: boolean }>;
}

export interface QuestionFixture {
  functionName: string;
  signature: ProblemSignature;
  compareMode: CompareMode;
  /** Starter code per language, verbatim from the seed. */
  starterCode: Record<string, string>;
  testCases: TestCase[];
}

export async function loadSeedQuestion(slug: string): Promise<QuestionFixture> {
  const file = path.join(QUESTIONS_DIR, `${slug}.json`);
  const q: SeedQuestion = JSON.parse(await readFile(file, 'utf8'));
  return {
    functionName: q.function_name,
    signature: q.signature,
    compareMode: q.compare_mode ?? 'ordered',
    starterCode: q.starter_code,
    testCases: q.tests.map((t) => ({
      input: t.input,
      expectedOutput: t.expected,
      hidden: t.hidden ?? false,
    })),
  };
}

/** Length of the longest array or string argument in any test. */
export function largestArgument(testCases: readonly TestCase[]): number {
  let max = 0;
  for (const tc of testCases) {
    for (const arg of tc.input) {
      if (Array.isArray(arg) || typeof arg === 'string') max = Math.max(max, arg.length);
    }
  }
  return max;
}
