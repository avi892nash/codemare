/**
 * Authoring model (artboard A1) — the pure rules behind /author/new and
 * /author/[id]/edit. No React, no DB, no server-only imports: the editor runs
 * them live on every keystroke, and lib/server/author.ts runs the very same
 * functions again before it saves or publishes (the client is never trusted).
 *
 *   · the editor's draft shape (what the client sends to the server actions)
 *   · slugify, identifier rules (legal in all six languages)
 *   · starter-stub generation from a signature (spec §2.1 conventions)
 *   · test-value type checks for the typed harnesses (C++, Java, Go)
 *   · the publish checklist
 */
import {
  DEFAULT_HINT_SCORE_COST,
  HINT_LEVELS,
  LANGUAGES,
  SIGNATURE_BASE_TYPES,
  type CompareMode,
  type Difficulty,
  type HintCostKind,
  type HintLevel,
  type PublishStatus,
  type Signature,
  type SignatureBaseType,
  type SignatureType,
  type SupportedLanguage,
  type TestDef,
} from '@/lib/types';

// ═══ Vocabulary ═════════════════════════════════════════════════════════

export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  cpp: 'C++',
  java: 'Java',
  go: 'Go',
};

/** Every type the signature builder offers: six scalars × up to two `[]`. */
export const SIGNATURE_TYPES: SignatureType[] = SIGNATURE_BASE_TYPES.flatMap((b) => [
  b,
  `${b}[]` as SignatureType,
  `${b}[][]` as SignatureType,
]);

export const HINT_LEVEL_LABEL: Record<HintLevel, string> = {
  nudge: 'Nudge',
  concept: 'Concept',
  pseudo: 'Pseudocode',
  line: 'Key line',
  solution: 'Solution',
};

/** The compile service rejects limits above these (400, not clamped). */
export const LIMITS = {
  timeMs: { min: 100, max: 10_000, default: 2000 },
  memoryMb: { min: 16, max: 512, default: 256 },
} as const;

/** Publish needs at least this many hidden tests (and one visible). */
export const MIN_HIDDEN_TESTS = 3;

/** Source size cap per language (same as submissions, spec §4). */
export const MAX_SOURCE_BYTES = 64 * 1024;

// ═══ Draft shape ════════════════════════════════════════════════════════

export interface DraftTopic {
  slug: string;
  /** Share of the solve award this topic gets (question_topics.weight). */
  weight: number;
}

export interface DraftExample {
  input: string;
  output: string;
  explanation: string;
}

export interface DraftParam {
  name: string;
  type: SignatureType;
}

/**
 * One test as the author types it: `args` is the JSON argument list
 * (`[[2,7,11,15], 9]`), `expected` any JSON value. Parsed on validation.
 */
export interface DraftTest {
  args: string;
  expected: string;
  hidden: boolean;
  explainOnFail: string;
}

export interface DraftHint {
  level: HintLevel;
  bodyMd: string;
  costKind: HintCostKind;
  /** score: % penalty (0–100) on the solve award · token: tokens spent. */
  costAmount: number;
}

/** The whole question as the editor holds it (and sends to the server). */
export interface QuestionDraft {
  /** null until the first save. */
  id: string | null;
  title: string;
  slug: string;
  difficulty: Difficulty;
  topics: DraftTopic[];
  tags: string[];
  companies: string[];
  statementMd: string;
  constraints: string[];
  examples: DraftExample[];
  functionName: string;
  params: DraftParam[];
  returns: SignatureType;
  compareMode: CompareMode;
  timeLimitMs: number;
  memoryLimitMb: number;
  /** All six languages; '' = not written yet. */
  starterCode: Record<SupportedLanguage, string>;
  tests: DraftTest[];
  /** '' = none for that language. Python is required to publish. */
  referenceSolutions: Record<SupportedLanguage, string>;
  /** Always the five ladder levels, in order. */
  hints: DraftHint[];
  editorialMd: string;
}

/** Server-side facts the editor shows but never sends back. */
export interface DraftMeta {
  status: PublishStatus;
  updatedAt: string | null;
  /** Owner's handle (staff may edit other authors' questions). */
  authorHandle: string | null;
}

const byLanguage = <T>(value: T): Record<SupportedLanguage, T> =>
  Object.fromEntries(LANGUAGES.map((l) => [l, value])) as Record<SupportedLanguage, T>;

export function defaultHints(): DraftHint[] {
  return HINT_LEVELS.map((level) => ({ level, bodyMd: '', costKind: 'score', costAmount: DEFAULT_HINT_SCORE_COST[level] }));
}

export function emptyTest(hidden = false): DraftTest {
  return { args: '', expected: '', hidden, explainOnFail: '' };
}

/** A fresh question: one int parameter, one visible and three hidden empty tests. */
export function emptyDraft(): QuestionDraft {
  const params: DraftParam[] = [{ name: 'nums', type: 'int[]' }];
  return {
    id: null,
    title: '',
    slug: '',
    difficulty: 'Easy',
    topics: [],
    tags: [],
    companies: [],
    statementMd: '',
    constraints: [],
    examples: [{ input: '', output: '', explanation: '' }],
    functionName: '',
    params,
    returns: 'int',
    compareMode: 'ordered',
    timeLimitMs: LIMITS.timeMs.default,
    memoryLimitMb: LIMITS.memoryMb.default,
    starterCode: byLanguage(''),
    tests: [emptyTest(false), emptyTest(true), emptyTest(true), emptyTest(true)],
    referenceSolutions: byLanguage(''),
    hints: defaultHints(),
    editorialMd: '',
  };
}

// ═══ Slugs, tags ════════════════════════════════════════════════════════

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** "Two Sum II — Input Array Is Sorted" → "two-sum-ii-input-array-is-sorted". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/** Tags are kebab-case like the seeded ones ("hash-table"). */
export function normalizeTag(tag: string): string {
  return slugify(tag).slice(0, 40);
}

/** Companies keep their casing; whitespace collapses. */
export function normalizeCompany(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 60);
}

// ═══ Identifiers ════════════════════════════════════════════════════════

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Words that cannot name the function or a parameter because they are
 * keywords (or would break a harness) in at least one of the six languages.
 * Stubs put these names verbatim into every language.
 */
const RESERVED: Record<string, string> = {};
function reserve(lang: string, words: string) {
  for (const w of words.split(/\s+/).filter(Boolean)) RESERVED[w] = RESERVED[w] ? `${RESERVED[w]}, ${lang}` : lang;
}
reserve(
  'Python',
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'
);
reserve(
  'JavaScript',
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await arguments eval'
);
reserve(
  'C++',
  'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq main std string vector'
);
reserve(
  'Java',
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var yield record sealed permits String Solution Main'
);
reserve(
  'Go',
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var bool byte int int64 float64 rune error any nil true false iota len cap make new append copy delete panic recover print println main'
);

/** The languages that reserve `name`, or null if it is free everywhere. */
export function reservedIn(name: string): string | null {
  return Object.prototype.hasOwnProperty.call(RESERVED, name) ? RESERVED[name] : null;
}

/** Why `name` cannot be used as an identifier in every language (null = fine). */
export function identifierIssue(name: string, what: string): string | null {
  if (!name) return `${what} is missing`;
  if (!IDENTIFIER_RE.test(name)) return `${what} "${name}" must start with a letter or _ and use only letters, digits and _`;
  if (name.length > 40) return `${what} "${name}" is longer than 40 characters`;
  if (name.startsWith('__')) return `${what} "${name}" must not start with "__" (reserved for the judge's harness)`;
  const langs = reservedIn(name);
  if (langs) return `${what} "${name}" is reserved in ${langs}`;
  return null;
}

// ═══ Signature types ════════════════════════════════════════════════════

export interface ParsedType {
  base: SignatureBaseType;
  dims: 0 | 1 | 2;
}

export function parseType(type: string): ParsedType | null {
  const m = /^(int|long|double|bool|string|char)((?:\[\]){0,2})$/.exec(type);
  if (!m) return null;
  return { base: m[1] as SignatureBaseType, dims: (m[2].length / 2) as 0 | 1 | 2 };
}

export function isSignatureType(value: unknown): value is SignatureType {
  return typeof value === 'string' && parseType(value) !== null;
}

export function draftSignature(draft: Pick<QuestionDraft, 'params' | 'returns'>): Signature {
  return { params: draft.params.map((p) => ({ name: p.name, type: p.type })), returns: draft.returns };
}

/** A JSON value's fit for a signature type; null when it fits. Mirrors the harnesses' literal rules. */
export function valueIssue(type: SignatureType, value: unknown): string | null {
  const t = parseType(type);
  if (!t) return `unsupported type ${type}`;
  if (t.dims > 0) {
    if (!Array.isArray(value)) return `expected ${type}, got ${describe(value)}`;
    const inner = type.slice(0, -2) as SignatureType;
    for (let i = 0; i < value.length; i++) {
      const issue = valueIssue(inner, value[i]);
      if (issue) return `[${i}]: ${issue}`;
    }
    return null;
  }
  switch (t.base) {
    case 'int':
      return Number.isInteger(value) && (value as number) >= -(2 ** 31) && (value as number) < 2 ** 31
        ? null
        : `expected int (32-bit), got ${describe(value)}`;
    case 'long':
      return Number.isSafeInteger(value) ? null : `expected long (|x| < 2^53), got ${describe(value)}`;
    case 'double':
      return typeof value === 'number' && Number.isFinite(value) ? null : `expected double, got ${describe(value)}`;
    case 'bool':
      return typeof value === 'boolean' ? null : `expected bool, got ${describe(value)}`;
    case 'string':
      return typeof value === 'string' ? null : `expected string, got ${describe(value)}`;
    case 'char':
      return typeof value === 'string' && value.length === 1 && value.charCodeAt(0) < 128
        ? null
        : `expected char (one ASCII character), got ${describe(value)}`;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return value.length > 12 ? 'a string' : JSON.stringify(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : `${value}`;
  return typeof value;
}

// ═══ Starter stubs (spec §2.1: every stub compiles verbatim) ═════════════

const CPP_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int', long: 'long long', double: 'double', bool: 'bool', string: 'string', char: 'char',
};
const JAVA_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int', long: 'long', double: 'double', bool: 'boolean', string: 'String', char: 'char',
};
const GO_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int', long: 'int64', double: 'float64', bool: 'bool', string: 'string', char: 'byte',
};
const TS_SCALAR: Record<SignatureBaseType, string> = {
  int: 'number', long: 'number', double: 'number', bool: 'boolean', string: 'string', char: 'string',
};

function cppType(t: ParsedType): string {
  let s = CPP_SCALAR[t.base];
  for (let i = 0; i < t.dims; i++) s = `vector<${s}>`;
  return s;
}
const javaType = (t: ParsedType) => JAVA_SCALAR[t.base] + '[]'.repeat(t.dims);
const goType = (t: ParsedType) => '[]'.repeat(t.dims) + GO_SCALAR[t.base];
const tsType = (t: ParsedType) => TS_SCALAR[t.base] + '[]'.repeat(t.dims);

function cppZero(t: ParsedType): string {
  if (t.dims) return '{}';
  return { int: '0', long: '0', double: '0.0', bool: 'false', string: '""', char: "'\\0'" }[t.base];
}
function javaZero(t: ParsedType): string {
  if (t.dims) return `new ${javaType(t)}{}`;
  return { int: '0', long: '0L', double: '0.0', bool: 'false', string: '""', char: "'\\0'" }[t.base];
}
function goZero(t: ParsedType): string {
  if (t.dims) return 'nil';
  return { int: '0', long: '0', double: '0', bool: 'false', string: '""', char: '0' }[t.base];
}
function tsZero(t: ParsedType): string {
  if (t.dims) return '[]';
  return { int: '0', long: '0', double: '0', bool: 'false', string: '""', char: '""' }[t.base];
}

/**
 * The starter stub for one language, following the seeded questions'
 * conventions exactly: C++ passes vectors by reference and adds only the
 * headers it needs; Java wraps a static method in `class Solution`; Go has
 * no package clause and no imports; TypeScript is fully typed; non-void
 * stubs return a zero value. Unknown types fall back to `int`.
 */
export function generateStub(language: SupportedLanguage, functionName: string, signature: Signature): string {
  const fn = functionName || 'solve';
  const params = signature.params.map((p) => ({ name: p.name, t: parseType(p.type) ?? { base: 'int' as const, dims: 0 as const } }));
  const ret = parseType(signature.returns) ?? { base: 'int' as const, dims: 0 as const };
  const names = params.map((p) => p.name).join(', ');
  switch (language) {
    case 'python':
      return `def ${fn}(${names}):\n    # Write your code here\n    pass\n`;
    case 'javascript':
      return `function ${fn}(${names}) {\n    // Write your code here\n}\n`;
    case 'typescript': {
      const list = params.map((p) => `${p.name}: ${tsType(p.t)}`).join(', ');
      return `function ${fn}(${list}): ${tsType(ret)} {\n    // Write your code here\n    return ${tsZero(ret)};\n}\n`;
    }
    case 'cpp': {
      const all = [...params.map((p) => p.t), ret];
      const includes = [
        all.some((t) => t.base === 'string') && '#include <string>',
        all.some((t) => t.dims > 0) && '#include <vector>',
      ].filter(Boolean);
      const list = params
        .map((p) => (p.t.dims > 0 ? `${cppType(p.t)}& ${p.name}` : `${cppType(p.t)} ${p.name}`))
        .join(', ');
      const head = includes.length ? `${includes.join('\n')}\n` : '';
      return `${head}using namespace std;\n\n${cppType(ret)} ${fn}(${list}) {\n    // Write your code here\n    return ${cppZero(ret)};\n}\n`;
    }
    case 'java': {
      const list = params.map((p) => `${javaType(p.t)} ${p.name}`).join(', ');
      return (
        `class Solution {\n    public static ${javaType(ret)} ${fn}(${list}) {\n` +
        `        // Write your code here\n        return ${javaZero(ret)};\n    }\n}\n`
      );
    }
    case 'go': {
      const list = params.map((p) => `${p.name} ${goType(p.t)}`).join(', ');
      return `func ${fn}(${list}) ${goType(ret)} {\n\t// Write your code here\n\treturn ${goZero(ret)}\n}\n`;
    }
  }
}

export function generateStubs(functionName: string, signature: Signature): Record<SupportedLanguage, string> {
  return Object.fromEntries(LANGUAGES.map((l) => [l, generateStub(l, functionName, signature)])) as Record<
    SupportedLanguage,
    string
  >;
}

/** One-line signature previews for the builder (C++, Java, Go, TypeScript). */
export function signaturePreview(language: 'cpp' | 'java' | 'go' | 'typescript', functionName: string, signature: Signature): string {
  const fn = functionName || 'solve';
  const params = signature.params.map((p) => ({ name: p.name || '_', t: parseType(p.type) ?? { base: 'int' as const, dims: 0 as const } }));
  const ret = parseType(signature.returns) ?? { base: 'int' as const, dims: 0 as const };
  switch (language) {
    case 'cpp':
      return `${cppType(ret)} ${fn}(${params.map((p) => (p.t.dims ? `${cppType(p.t)}& ${p.name}` : `${cppType(p.t)} ${p.name}`)).join(', ')})`;
    case 'java':
      return `static ${javaType(ret)} ${fn}(${params.map((p) => `${javaType(p.t)} ${p.name}`).join(', ')})`;
    case 'go':
      return `func ${fn}(${params.map((p) => `${p.name} ${goType(p.t)}`).join(', ')}) ${goType(ret)}`;
    case 'typescript':
      return `function ${fn}(${params.map((p) => `${p.name}: ${tsType(p.t)}`).join(', ')}): ${tsType(ret)}`;
  }
}

// ═══ Tests ══════════════════════════════════════════════════════════════

export type ParsedTest =
  | { ok: true; input: unknown[]; expected: unknown }
  | { ok: false; field: 'args' | 'expected'; message: string };

/** A test's argument list: must be a JSON array (one element per parameter). */
export function parseArgs(text: string): { ok: true; input: unknown[] } | { ok: false; message: string } {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, message: text.trim() ? 'Arguments are not valid JSON' : 'Arguments are empty' };
  }
  if (!Array.isArray(input)) return { ok: false, message: 'Arguments must be a JSON array: one element per parameter' };
  return { ok: true, input };
}

/** A test's expected output: any JSON value. `missing` when the field is still empty. */
export function parseExpected(text: string): { ok: true; expected: unknown } | { ok: false; missing: boolean; message: string } {
  if (!text.trim()) return { ok: false, missing: true, message: 'Expected output is empty' };
  try {
    return { ok: true, expected: JSON.parse(text) };
  } catch {
    return { ok: false, missing: false, message: 'Expected output is not valid JSON' };
  }
}

/** Parse a draft test's JSON fields. */
export function parseTest(test: Pick<DraftTest, 'args' | 'expected'>): ParsedTest {
  const args = parseArgs(test.args);
  if (!args.ok) return { ok: false, field: 'args', message: args.message };
  const expected = parseExpected(test.expected);
  if (!expected.ok) return { ok: false, field: 'expected', message: expected.message };
  return { ok: true, input: args.input, expected: expected.expected };
}

/**
 * A placeholder of the return type — stands in for a test's expected output
 * before the author has one, so the typed harnesses can still run the
 * reference (whose outputs then fill the blanks).
 */
export function zeroValue(type: SignatureType): unknown {
  const t = parseType(type);
  if (!t) return 0;
  if (t.dims) return [];
  return { int: 0, long: 0, double: 0, bool: false, string: '', char: 'a' }[t.base];
}

/** Where a parsed test does not fit the signature (arity, then each value). */
export function testFitIssues(signature: Signature, input: unknown[], expected: unknown): string[] {
  const issues: string[] = [];
  if (input.length !== signature.params.length) {
    issues.push(`has ${input.length} argument${input.length === 1 ? '' : 's'}; the signature takes ${signature.params.length}`);
    return issues;
  }
  signature.params.forEach((p, i) => {
    if (!isSignatureType(p.type)) return;
    const issue = valueIssue(p.type, input[i]);
    if (issue) issues.push(`argument ${i + 1} (${p.name || '?'}): ${issue}`);
  });
  if (isSignatureType(signature.returns)) {
    const issue = valueIssue(signature.returns, expected);
    if (issue) issues.push(`expected output: ${issue}`);
  }
  return issues;
}

/** Pretty JSON for the editor fields: compact for scalars and flat arrays. */
export function formatJson(value: unknown): string {
  const compact = JSON.stringify(value);
  return compact ?? 'null';
}

/** The stored TestDef[] for a draft — only valid tests (drafts keep work in progress server-side). */
export function toTestDefs(tests: DraftTest[]): TestDef[] {
  const out: TestDef[] = [];
  for (const t of tests) {
    const p = parseTest(t);
    if (!p.ok) continue;
    const def: TestDef = { input: p.input, expected: p.expected, hidden: t.hidden };
    if (t.explainOnFail.trim()) def.explain_on_fail = t.explainOnFail.trim();
    out.push(def);
  }
  return out;
}

export function fromTestDefs(tests: TestDef[]): DraftTest[] {
  return tests.map((t) => ({
    args: formatJson(t.input),
    expected: formatJson(t.expected),
    hidden: t.hidden,
    explainOnFail: t.explain_on_fail ?? '',
  }));
}

// ═══ Reference runs ═════════════════════════════════════════════════════

export type RunVerdictCode = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

/** One test of a reference run, as the server action returns it. */
export interface ReferenceTestResult {
  idx: number;
  passed: boolean;
  hidden: boolean;
  actual: unknown;
  /** false when the run produced no value for this test (error, crash). */
  hasActual: boolean;
  /** The test had no (valid) expected output yet: pass/fail is meaningless, fill it from `actual`. */
  expectedMissing: boolean;
  error: string | null;
  runUs: number;
  memoryKb: number;
}

export interface ReferenceRun {
  language: SupportedLanguage;
  status: RunVerdictCode;
  totalPassed: number;
  totalTests: number;
  compileMs: number | null;
  error: string | null;
  tests: ReferenceTestResult[];
  /** referenceFingerprint() of the content this run judged. */
  fingerprint: string;
}

/** 32-bit FNV-1a, hex. Cheap change detection, not security. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function canonicalJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return `!${text}`;
  }
}

/**
 * Everything a reference run's verdict depends on. A run whose fingerprint
 * no longer matches the draft is stale: the checklist asks for a re-run.
 * Whitespace-only edits to test JSON and hidden/explain flags do not count.
 */
export function referenceFingerprint(draft: QuestionDraft, language: SupportedLanguage): string {
  return fnv1a(
    JSON.stringify([
      language,
      draft.referenceSolutions[language],
      draft.functionName,
      draft.params.map((p) => [p.name, p.type]),
      draft.returns,
      draft.compareMode,
      draft.timeLimitMs,
      draft.memoryLimitMb,
      draft.tests.map((t) => [canonicalJson(t.args), canonicalJson(t.expected)]),
    ])
  );
}

/** Languages with a reference solution, python first. */
export function providedReferences(draft: Pick<QuestionDraft, 'referenceSolutions'>): SupportedLanguage[] {
  return LANGUAGES.filter((l) => draft.referenceSolutions[l].trim().length > 0);
}

/** Tests whose expected output a run can fill: it produced a value and it differs (or was missing). */
export function fillableTests(run: Pick<ReferenceRun, 'tests'>): ReferenceTestResult[] {
  return run.tests.filter((t) => t.hasActual && (t.expectedMissing || !t.passed));
}

/**
 * "Fill expected outputs from the reference": copy the run's actual values
 * into the tests it covers. Returns the new draft, and — because every
 * filled test now expects exactly what the reference produced — the run
 * re-stamped for the new content (all filled tests passing). The server
 * still re-runs every reference on publish.
 */
export function fillExpectedFromRun(
  draft: QuestionDraft,
  run: ReferenceRun,
  /** Limit the fill to these test indexes (default: every fillable test). */
  only?: readonly number[]
): { draft: QuestionDraft; run: ReferenceRun } {
  // A stale run's indexes may no longer line up with the tests: never fill from it.
  if (run.fingerprint !== referenceFingerprint(draft, run.language)) return { draft, run };
  const fill = new Map(fillableTests(run).filter((t) => !only || only.includes(t.idx)).map((t) => [t.idx, t]));
  const tests = draft.tests.map((t, i) => (fill.has(i) ? { ...t, expected: formatJson(fill.get(i)!.actual) } : t));
  const next = { ...draft, tests };
  const results = run.tests.map((t) => (fill.has(t.idx) ? { ...t, passed: true, expectedMissing: false } : t));
  const totalPassed = results.filter((t) => t.passed).length;
  const clean = run.status !== 'CE' && run.status !== 'XX' && results.length === draft.tests.length;
  return {
    draft: next,
    run: {
      ...run,
      tests: results,
      totalPassed,
      status: clean && totalPassed === results.length ? 'OK' : run.status,
      fingerprint: clean ? referenceFingerprint(next, run.language) : run.fingerprint,
    },
  };
}

// ═══ Publish checklist ══════════════════════════════════════════════════

export type SectionId =
  | 'basics'
  | 'statement'
  | 'examples'
  | 'signature'
  | 'starter'
  | 'tests'
  | 'reference'
  | 'hints'
  | 'editorial';

export type CheckKey = 'basics' | 'statement' | 'signature' | 'starter' | 'tests' | 'reference' | 'hints';

export interface CheckItem {
  key: CheckKey;
  label: string;
  ok: boolean;
  /** Human problems, most important first (empty when ok). */
  problems: string[];
  /** Where to fix it. */
  section: SectionId;
  /** Needs a reference run (not a pure field check). */
  dynamic?: boolean;
}

/** How a run went, separating real failures from tests that simply had no expected output yet. */
export function runOutcome(run: Pick<ReferenceRun, 'status' | 'totalPassed' | 'totalTests'> & { tests?: ReferenceTestResult[] }) {
  const tests = run.tests ?? [];
  const missing = tests.filter((t) => t.expectedMissing).length;
  const failing = tests.length ? tests.filter((t) => !t.passed && !t.expectedMissing).length : run.totalTests - run.totalPassed;
  const broken = run.status === 'CE' || run.status === 'XX';
  /** Every test passed except those still waiting for an expected output. */
  const onlyMissing = !broken && failing === 0 && missing > 0;
  return { missing, failing, broken, onlyMissing };
}

export interface ChecklistContext {
  /** Latest reference run per language (client state; the server re-runs on publish). */
  runs?: Partial<
    Record<
      SupportedLanguage,
      Pick<ReferenceRun, 'status' | 'totalPassed' | 'totalTests' | 'fingerprint'> & { tests?: ReferenceTestResult[] }
    >
  >;
  /** Topic slugs that exist (unknown ones fail basics). Omit to skip the check. */
  knownTopics?: ReadonlySet<string>;
}

function basicsProblems(d: QuestionDraft, known?: ReadonlySet<string>): string[] {
  const p: string[] = [];
  if (!d.title.trim()) p.push('Add a title');
  else if (d.title.trim().length > 120) p.push('Keep the title under 120 characters');
  if (!d.slug) p.push('Add a slug');
  else if (!SLUG_RE.test(d.slug) || d.slug.length > SLUG_MAX) p.push('The slug must be kebab-case (a–z, 0–9, single dashes)');
  if (d.topics.length === 0) p.push('Pick at least one topic');
  const slugs = d.topics.map((t) => t.slug);
  if (new Set(slugs).size !== slugs.length) p.push('A topic is listed twice');
  for (const t of d.topics) {
    if (known && !known.has(t.slug)) p.push(`Unknown topic "${t.slug}"`);
    if (!(t.weight > 0 && t.weight <= 10)) p.push(`Topic "${t.slug}" needs a weight between 0 and 10`);
  }
  return p;
}

function statementProblems(d: QuestionDraft): string[] {
  const p: string[] = [];
  if (d.statementMd.trim().length < 10) p.push('Write the problem statement');
  const complete = d.examples.filter((e) => e.input.trim() && e.output.trim());
  if (complete.length === 0) p.push('Add at least one example with an input and an output');
  if (complete.length !== d.examples.length) p.push('Every example needs an input and an output');
  return p;
}

/** Function name, parameters, and whether every test value fits the typed harnesses. */
export function signatureProblems(d: QuestionDraft): string[] {
  const p: string[] = [];
  const fnIssue = identifierIssue(d.functionName, 'Function name');
  if (fnIssue) p.push(fnIssue);
  const seen = new Set<string>();
  d.params.forEach((param, i) => {
    const issue = identifierIssue(param.name, `Parameter ${i + 1}`);
    if (issue) p.push(issue);
    else if (seen.has(param.name)) p.push(`Parameter "${param.name}" appears twice`);
    else if (param.name === d.functionName) p.push(`Parameter "${param.name}" shadows the function name`);
    seen.add(param.name);
    if (!isSignatureType(param.type)) p.push(`Parameter ${i + 1} has an unsupported type`);
  });
  if (!isSignatureType(d.returns)) p.push('Pick a return type');
  const signature = draftSignature(d);
  d.tests.forEach((t, i) => {
    const parsed = parseTest(t);
    if (!parsed.ok) return; // reported by the tests check
    for (const issue of testFitIssues(signature, parsed.input, parsed.expected)) p.push(`Test ${i + 1} ${issue}`);
  });
  return p;
}

function starterProblems(d: QuestionDraft): string[] {
  const p: string[] = [];
  const fnOk = IDENTIFIER_RE.test(d.functionName);
  for (const lang of LANGUAGES) {
    const code = d.starterCode[lang];
    const name = LANGUAGE_NAMES[lang];
    if (!code.trim()) {
      p.push(`Add ${name} starter code`);
      continue;
    }
    if (new TextEncoder().encode(code).length > MAX_SOURCE_BYTES) p.push(`${name} starter code is over 64 KB`);
    if (fnOk && !new RegExp(`\\b${d.functionName}\\b`).test(code)) p.push(`${name} starter code does not define ${d.functionName}`);
    if (lang === 'go' && /^\s*(package|import)\b/m.test(code)) p.push('Go starter code must not have a package clause or imports');
    if (lang === 'java' && !/\bclass\s+Solution\b/.test(code)) p.push('Java starter code must declare class Solution');
  }
  return p;
}

function testsProblems(d: QuestionDraft): string[] {
  const p: string[] = [];
  d.tests.forEach((t, i) => {
    const parsed = parseTest(t);
    if (!parsed.ok) p.push(`Test ${i + 1}: ${parsed.message}`);
  });
  const hidden = d.tests.filter((t) => t.hidden).length;
  const visible = d.tests.length - hidden;
  if (hidden < MIN_HIDDEN_TESTS) p.push(`Add at least ${MIN_HIDDEN_TESTS} hidden tests (${hidden} so far)`);
  if (visible < 1) p.push('Add at least one visible test so learners can press Run');
  return p;
}

function referenceProblems(d: QuestionDraft, runs: ChecklistContext['runs'] = {}): string[] {
  const p: string[] = [];
  if (!d.referenceSolutions.python.trim()) p.push('A Python reference solution is required');
  for (const lang of providedReferences(d)) {
    const name = LANGUAGE_NAMES[lang];
    if (new TextEncoder().encode(d.referenceSolutions[lang]).length > MAX_SOURCE_BYTES) {
      p.push(`${name} reference is over 64 KB`);
      continue;
    }
    const run = runs[lang];
    if (!run) p.push(`Run the ${name} reference against the tests`);
    else if (run.fingerprint !== referenceFingerprint(d, lang)) p.push(`Re-run the ${name} reference: the code or tests changed`);
    else if (run.status !== 'OK' || run.totalPassed !== run.totalTests) {
      const o = runOutcome(run);
      p.push(
        o.broken
          ? `${name} reference: ${run.status === 'CE' ? 'compilation error' : 'the judge failed'}`
          : o.onlyMissing
            ? `${o.missing} test${o.missing === 1 ? ' has' : 's have'} no expected output — fill ${o.missing === 1 ? 'it' : 'them'} from the ${name} run`
            : `${name} reference fails ${o.failing} of ${run.totalTests} tests`
      );
    }
  }
  return p;
}

function hintProblems(d: QuestionDraft): string[] {
  const p: string[] = [];
  for (const level of HINT_LEVELS) {
    const h = d.hints.find((x) => x.level === level);
    if (!h || !h.bodyMd.trim()) {
      p.push(`Write the ${HINT_LEVEL_LABEL[level].toLowerCase()} hint`);
      continue;
    }
    if (!Number.isInteger(h.costAmount) || h.costAmount < 0) p.push(`${HINT_LEVEL_LABEL[level]} hint: cost must be a whole number ≥ 0`);
    else if (h.costKind === 'score' && h.costAmount > 100) p.push(`${HINT_LEVEL_LABEL[level]} hint: a score cost is a percentage (0–100)`);
  }
  return p;
}

/**
 * The publish rail's checklist. Publishing requires every item ok; the
 * server recomputes it (with a fresh reference run) before it publishes.
 */
export function computeChecklist(d: QuestionDraft, ctx: ChecklistContext = {}): CheckItem[] {
  const item = (key: CheckKey, label: string, section: SectionId, problems: string[], dynamic = false): CheckItem => ({
    key,
    label,
    section,
    problems,
    ok: problems.length === 0,
    ...(dynamic ? { dynamic } : {}),
  });
  return [
    item('basics', 'Title, slug, difficulty and topics', 'basics', basicsProblems(d, ctx.knownTopics)),
    item('statement', 'Statement and at least one example', 'statement', statementProblems(d)),
    item('signature', 'Signature valid for C++, Java and Go', 'signature', signatureProblems(d)),
    item('starter', 'Starter code in all six languages', 'starter', starterProblems(d)),
    item('tests', `At least ${MIN_HIDDEN_TESTS} hidden tests`, 'tests', testsProblems(d)),
    item('reference', 'Reference passes every test', 'reference', referenceProblems(d, ctx.runs), true),
    item('hints', 'Hint ladder complete (5 levels)', 'hints', hintProblems(d)),
  ];
}

export function checklistPasses(items: readonly CheckItem[]): boolean {
  return items.every((i) => i.ok);
}
