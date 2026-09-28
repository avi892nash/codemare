import { z } from 'zod';
import { SANDBOX_CONFIG } from '../config/sandbox.js';
import { Language } from '../models/ExecutionResult.js';
import { CompareMode, ProblemSignature, SignatureBaseType, SignatureType } from '../models/Problem.js';
import { RunRequest, RunTestSpec } from '../models/Run.js';
import { parseSignatureType } from './codeWrapperService.js';

/**
 * Hard validation at the /v1/run boundary. Everything here is the caller's
 * mistake and answers 400 before any sandbox work starts (and before an SSE
 * stream opens). Learner mistakes — syntax errors, wrong answers — are not
 * validation failures; they come back as verdicts.
 */
export const RUN_LIMITS = {
  maxCodeBytes: 64 * 1024,
  maxPreludeBytes: 256 * 1024,
  maxPreludePieces: 64,
  maxTests: 200,
  /** Serialized input + expected of one test. */
  maxTestBytes: 512 * 1024,
  /** Serialized input + expected of all tests together. */
  maxTotalTestBytes: 4 * 1024 * 1024,
  maxParams: 20,
  /** Nesting depth of any test value (signature types need at most 2). */
  maxJsonDepth: 32,
  timeMs: { min: 100, max: 10_000 },
  memoryMb: { min: 32, max: 512 },
} as const;

/** express.json limit for the run routes: ~code + prelude + tests + JSON overhead. */
export const RUN_BODY_LIMIT = '6mb';

export const DEFAULT_TIME_MS = SANDBOX_CONFIG.limits.timeoutMs;
export const DEFAULT_MEMORY_MB = SANDBOX_CONFIG.limits.memoryKb / 1024;

/** Languages whose harness is generated from typed literals. */
export const TYPED_LANGUAGES: ReadonlySet<Language> = new Set(['cpp', 'java', 'go']);

export interface ValidatedRunRequest {
  language: Language;
  code: string;
  prelude: string[];
  functionName: string;
  signature?: ProblemSignature;
  compareMode: CompareMode;
  tests: Array<Required<RunTestSpec>>;
  limits: { timeMs: number; memoryMb: number };
}

export type RunValidation =
  | { ok: true; value: ValidatedRunRequest }
  | { ok: false; error: string; details: string[] };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isSignatureType(value: string): boolean {
  try {
    parseSignatureType(value as SignatureType);
    return true;
  } catch {
    return false;
  }
}

const identifier = z
  .string()
  .max(64)
  .regex(IDENTIFIER, 'must be an identifier ([A-Za-z_][A-Za-z0-9_]*)');

const signatureType = z
  .string()
  .refine(isSignatureType, (v) => ({
    message: `unsupported type ${JSON.stringify(v)} (int, long, double, bool, string or char, optionally with [] or [][])`,
  }));

const signatureSchema = z
  .object({
    params: z
      .array(z.object({ name: identifier, type: signatureType }).strict())
      .max(RUN_LIMITS.maxParams),
    returns: signatureType,
  })
  .strict();

// Tests are not .strict(): callers may pass stored test rows through as-is
// (e.g. with explain_on_fail); unknown keys are dropped.
const testSchema = z
  .object({
    input: z.array(z.unknown()).max(RUN_LIMITS.maxParams),
    expected: z.unknown(),
    hidden: z.boolean().optional(),
  })
  .refine((t) => t.expected !== undefined, { message: 'Required', path: ['expected'] });

// Top level is .strict() so a misspelt key (compare_mode, function_name) is a
// 400 instead of a silently ignored option.
const runRequestSchema = z
  .object({
    language: z.enum(['python', 'javascript', 'typescript', 'cpp', 'java', 'go']),
    code: z.string(),
    prelude: z.array(z.string()).max(RUN_LIMITS.maxPreludePieces).optional(),
    functionName: identifier,
    signature: signatureSchema.optional(),
    compareMode: z.enum(['ordered', 'unordered']).optional(),
    tests: z.array(testSchema).min(1).max(RUN_LIMITS.maxTests),
    limits: z
      .object({
        timeMs: z.number().int().min(RUN_LIMITS.timeMs.min).max(RUN_LIMITS.timeMs.max).optional(),
        memoryMb: z.number().int().min(RUN_LIMITS.memoryMb.min).max(RUN_LIMITS.memoryMb.max).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function formatPath(path: ReadonlyArray<string | number>): string {
  return path
    .map((p, k) => (typeof p === 'number' ? `[${p}]` : k === 0 ? p : `.${p}`))
    .join('');
}

function describe(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Depth of nested arrays/objects, computed without recursion. */
function exceedsDepth(value: unknown, maxDepth: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (depth > maxDepth) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v as object)) {
      stack.push([child, depth + 1]);
    }
  }
  return false;
}

function scalarError(
  base: SignatureBaseType,
  v: unknown,
  path: string,
  language: Language
): string | undefined {
  switch (base) {
    case 'int':
      return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647
        ? undefined
        : `${path}: expected int (32-bit integer), got ${describe(v)}`;
    case 'long':
      return Number.isSafeInteger(v)
        ? undefined
        : `${path}: expected long (an integer within ±2^53-1), got ${describe(v)}`;
    case 'double':
      return typeof v === 'number' && Number.isFinite(v)
        ? undefined
        : `${path}: expected double (a finite number), got ${describe(v)}`;
    case 'bool':
      return typeof v === 'boolean' ? undefined : `${path}: expected bool, got ${describe(v)}`;
    case 'string':
      return typeof v === 'string' ? undefined : `${path}: expected string, got ${describe(v)}`;
    case 'char': {
      // Java's char is one UTF-16 unit; C++ char and Go byte are one byte.
      const ok =
        typeof v === 'string' &&
        v.length === 1 &&
        (language === 'java' || v.charCodeAt(0) <= 0x7f);
      return ok
        ? undefined
        : `${path}: expected char (${language === 'java' ? 'a single character' : 'a single ASCII character'}), got ${describe(v)}`;
    }
  }
}

/** First mismatch between `value` and a signature type, or undefined. */
export function conformanceError(
  type: SignatureType,
  value: unknown,
  path: string,
  language: Language
): string | undefined {
  const { base, dims } = parseSignatureType(type);
  const walk = (v: unknown, d: number, at: string): string | undefined => {
    if (d === 0) return scalarError(base, v, at, language);
    if (!Array.isArray(v)) return `${at}: expected ${base}${'[]'.repeat(d)}, got ${describe(v)}`;
    for (let k = 0; k < v.length; k++) {
      const err = walk(v[k], d - 1, `${at}[${k}]`);
      if (err) return err;
    }
    return undefined;
  };
  return walk(value, dims, path);
}

/** Validate a /v1/run request body. */
export function validateRunRequest(body: unknown): RunValidation {
  const parsed = runRequestSchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) =>
      i.path.length > 0 ? `${formatPath(i.path)}: ${i.message}` : i.message
    );
    return { ok: false, error: details[0] ?? 'Invalid request', details };
  }
  const req = parsed.data as RunRequest;
  const details: string[] = [];
  const fail = (msg: string): void => {
    details.push(msg);
  };

  const prelude = req.prelude ?? [];
  if (req.code.trim() === '') fail('code: must not be empty');
  if (Buffer.byteLength(req.code, 'utf8') > RUN_LIMITS.maxCodeBytes) {
    fail(`code: exceeds ${RUN_LIMITS.maxCodeBytes / 1024} KB`);
  }
  const preludeBytes = prelude.reduce((n, p) => n + Buffer.byteLength(p, 'utf8'), 0);
  if (preludeBytes > RUN_LIMITS.maxPreludeBytes) {
    fail(`prelude: exceeds ${RUN_LIMITS.maxPreludeBytes / 1024} KB in total`);
  }
  if (req.language === 'java' && prelude.length > 0) {
    fail('prelude: not supported for java (the harness needs a single class Solution)');
  }

  const typed = TYPED_LANGUAGES.has(req.language);
  if (typed && !req.signature) fail(`signature: required for ${req.language}`);

  const fn = req.functionName;
  if (/^(__cm|_cm_)/.test(fn)) fail('functionName: the __cm / _cm_ prefixes are reserved for the harness');
  if ((req.language === 'cpp' || req.language === 'go') && fn === 'main') {
    fail(`functionName: "main" is reserved in ${req.language}`);
  }
  if (req.language === 'go' && fn === 'init') fail('functionName: "init" is reserved in go');

  let totalBytes = 0;
  req.tests.forEach((t, i) => {
    if (exceedsDepth(t.input, RUN_LIMITS.maxJsonDepth) || exceedsDepth(t.expected, RUN_LIMITS.maxJsonDepth)) {
      fail(`tests[${i}]: nested deeper than ${RUN_LIMITS.maxJsonDepth} levels`);
      return;
    }
    const bytes = JSON.stringify(t.input).length + (JSON.stringify(t.expected) ?? '').length;
    totalBytes += bytes;
    if (bytes > RUN_LIMITS.maxTestBytes) {
      fail(`tests[${i}]: input + expected exceed ${RUN_LIMITS.maxTestBytes / 1024} KB`);
    }
    const sig = req.signature;
    if (!sig) return;
    if (t.input.length !== sig.params.length) {
      fail(
        `tests[${i}].input: has ${t.input.length} value(s) but the signature declares ${sig.params.length} parameter(s)`
      );
      return;
    }
    if (typed) {
      for (let j = 0; j < sig.params.length; j++) {
        const err = conformanceError(sig.params[j].type, t.input[j], `tests[${i}].input[${j}]`, req.language);
        if (err) {
          fail(err);
          return;
        }
      }
      const err = conformanceError(sig.returns, t.expected, `tests[${i}].expected`, req.language);
      if (err) fail(err);
    }
  });
  if (totalBytes > RUN_LIMITS.maxTotalTestBytes) {
    fail(`tests: exceed ${RUN_LIMITS.maxTotalTestBytes / (1024 * 1024)} MB in total`);
  }

  if (details.length > 0) return { ok: false, error: details[0], details };

  return {
    ok: true,
    value: {
      language: req.language,
      code: req.code,
      prelude,
      functionName: fn,
      signature: req.signature,
      compareMode: req.compareMode ?? 'ordered',
      tests: req.tests.map((t) => ({ input: t.input, expected: t.expected, hidden: t.hidden ?? false })),
      limits: {
        timeMs: req.limits?.timeMs ?? DEFAULT_TIME_MS,
        memoryMb: req.limits?.memoryMb ?? DEFAULT_MEMORY_MB,
      },
    },
  };
}
