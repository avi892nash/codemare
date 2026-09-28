/**
 * Props of the solving surface. Everything here is serializable so a server
 * component can hand it straight to <SolveWorkspace>.
 */
import type { Difficulty, Signature, SubmissionKind, SubmissionStatus, SupportedLanguage } from '@/lib/types';
import type { HintLadder } from '@/lib/server/hints';

/**
 * question — a catalog question: Run (samples + custom inputs) and Submit.
 * build    — a component build step (/queue): one action, judged by /api/build.
 * gate     — a question inside a running gate attempt: Submit counts for the gate.
 */
export type WorkspaceMode = 'question' | 'build' | 'gate';

/** A visible (sample) test. Hidden tests never reach the browser. */
export interface SampleTest {
  input: unknown[];
  expected: unknown;
}

export interface WorkspaceProblem {
  /** Question id (question / gate) or build-step id (build). */
  id: string;
  /** Question slug (question / gate) — marks the current gate question. */
  slug?: string;
  title: string;
  difficulty: Difficulty;
  functionName: string;
  signature: Signature;
  /** Languages on offer, in display order. */
  languages: SupportedLanguage[];
  starterCode: Partial<Record<SupportedLanguage, string>>;
  samples: SampleTest[];
  /** Whole-run CPU limit (shown on TLE). */
  timeLimitMs?: number;
  /** Learner-added inputs can be judged (a reference solution exists). */
  customInputs?: boolean;
}

export interface SubmissionSummary {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  language: SupportedLanguage;
  runtimeUs: number | null;
  memoryKb: number | null;
  percentile: number | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface GateContext {
  attemptId: string;
  /** ISO timestamp. */
  deadlineAt: string;
  title: string;
  passThreshold: number;
  /** Every question of the gate, in order. */
  questions: { slug: string; title: string; solved: boolean }[];
  /** Where the learner goes to finish or leave the attempt. */
  backHref: string;
}

export interface BuildContext {
  componentSlug: string;
  componentTitle: string;
  /** Transitive dependencies whose latest passing version is prepended. */
  dependencies: { slug: string; title: string }[];
}

/** The hint ladder as `getHintLadder` returns it (JSON-safe). */
export type HintLadderView = HintLadder;
