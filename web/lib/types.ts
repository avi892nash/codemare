/**
 * Shared types for the web app. Client-safe: no runtime imports, only types
 * and small constant tables.
 *
 * Two halves:
 *   1. Domain vocabulary + the JSON column shapes of docs/spec/architecture.md
 *      §2.1. These mirror prisma/schema.prisma enums (string unions, so client
 *      components can use them without importing @prisma/client).
 *   2. The compile service's IDE-mode shapes (POST /v1/ide/execute), used by
 *      /ide, runnable lesson snippets and library code. The /v1/run types
 *      live next to their client in lib/compile.ts.
 */

// ═══ 1. Domain vocabulary ═══════════════════════════════════════════════

/** Ordered easiest → hardest. Recipe `min_difficulty` and debit order rely on it. */
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Every language questions support (spec §2 `Language` enum). */
export const LANGUAGES = ['python', 'javascript', 'typescript', 'cpp', 'java', 'go'] as const;
export type SupportedLanguage = (typeof LANGUAGES)[number];

/** Ordered: learner < author < staff < admin. */
export const ROLES = ['learner', 'author', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const VERDICTS = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABEL: Record<Verdict, string> = {
  OK: 'Accepted',
  WA: 'Wrong Answer',
  TLE: 'Time Limit Exceeded',
  MLE: 'Memory Limit Exceeded',
  RE: 'Runtime Error',
  CE: 'Compilation Error',
  XX: 'Internal Error',
};
export type SubmissionStatus = 'queued' | 'running' | Verdict;
export type SubmissionKind = 'run' | 'submit' | 'build' | 'gate';

export type CompareMode = 'ordered' | 'unordered';
export type PublishStatus = 'draft' | 'published';
export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';
export type TrackLevel = 'beginner' | 'intermediate' | 'advanced';
export type CheckpointKind = 'mcq' | 'short';

/** Hint ladder order: a level is revealable only after every lower one. */
export const HINT_LEVELS = ['nudge', 'concept', 'pseudo', 'line', 'solution'] as const;
export type HintLevel = (typeof HINT_LEVELS)[number];
export type HintCostKind = 'score' | 'token';
/** Default `score` costs (% penalty on the future token award), spec §3.6. */
export const DEFAULT_HINT_SCORE_COST: Record<HintLevel, number> = {
  nudge: 0,
  concept: 10,
  pseudo: 25,
  line: 40,
  solution: 100,
};

/** Tokens per solve before weight and hint penalty, spec §3.2. */
export const BASE_TOKENS: Record<Difficulty, number> = { Easy: 1, Medium: 2, Hard: 3 };

/**
 * Icon names content JSON (topics, badges, library areas) may use — the
 * shared vocabulary pinned in spec §8 (`IconName` in components/ui/Icon.tsx).
 */
export const CONTENT_ICON_NAMES = [
  // existing
  'check', 'x', 'circle', 'half-circle', 'check-circle', 'alert', 'zap', 'cpu', 'memory',
  'clock', 'search', 'filter', 'chev-down', 'chev-right', 'chev-left', 'chev-up', 'play',
  'pause', 'skip-back', 'skip-forward', 'graduation', 'sparkle', 'target', 'lightbulb', 'info',
  'alert-circle', 'gauge', 'arrow-right', 'arrow-down', 'send', 'copy', 'refresh', 'settings',
  'user', 'list', 'book', 'flame', 'github', 'google', 'lock', 'lock-open', 'eye', 'eye-off',
  'plus', 'minus', 'close', 'more', 'external', 'bookmark', 'thumb', 'msg', 'trophy', 'layers',
  'history', 'terminal', 'code', 'drag', 'star', 'bolt', 'trend', 'hash',
  // added by the UI kit
  'map', 'route', 'book-open', 'award', 'coin', 'sun', 'moon', 'log-out', 'git-branch', 'grid',
  'edit', 'trash', 'sort', 'repeat', 'shield', 'puzzle', 'network', 'table', 'window', 'arrows-lr',
] as const;
export type ContentIconName = (typeof CONTENT_ICON_NAMES)[number];

// ─── JSON column shapes (spec §2.1) ──────────────────────────────────────

export const SIGNATURE_BASE_TYPES = ['int', 'long', 'double', 'bool', 'string', 'char'] as const;
export type SignatureBaseType = (typeof SIGNATURE_BASE_TYPES)[number];
export type SignatureType = SignatureBaseType | `${SignatureBaseType}[]` | `${SignatureBaseType}[][]`;

/** `questions.signature`. */
export interface Signature {
  params: { name: string; type: SignatureType }[];
  returns: SignatureType;
}

/** One element of `questions.tests`. `input` is the argument list. */
export interface TestDef {
  input: unknown[];
  expected: unknown;
  hidden: boolean;
  explain_on_fail?: string;
}

/** One element of `questions.examples`. */
export interface Example {
  input: string;
  output: string;
  explanation?: string;
}

/** `badges.criteria` (spec §2.1). Semantics in lib/server/rules/badges.ts. */
export type BadgeCriteria =
  | { kind: 'first_accept' }
  | { kind: 'solves'; n: number }
  | { kind: 'solves_difficulty'; difficulty: Difficulty; n: number }
  | { kind: 'streak_days'; n: number }
  | { kind: 'no_hint_solves'; n: number }
  | { kind: 'topics_unlocked'; n: number }
  | { kind: 'tier_open'; tier_ord: number }
  | { kind: 'gate_first_try' }
  | { kind: 'lessons_completed'; n: number }
  | { kind: 'track_completed' }
  | { kind: 'fast_solve'; percentile: number };
export type BadgeCriteriaKind = BadgeCriteria['kind'];

/** `checkpoint_questions.answer`: mcq → index into `choices`; short → accepted answer(s). */
export type CheckpointAnswer = number | string | string[];

// ═══ 2. Compile-service IDE shapes (POST /v1/ide/execute) ═══════════════

/**
 * The original four-language set, still the `language` of IdeExecutionRequest
 * (lib/compile.ts's IdeRunRequest widens it to all six). New code uses
 * `SupportedLanguage`; fold this into it once nothing needs the narrower type.
 */
export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export type SandboxStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

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
  /** WA: a clean exit whose stdout differs from the case's expected output. */
  status?: SandboxStatus | 'WA';
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
