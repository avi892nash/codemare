/**
 * Pure checkpoint grading for `content.checkpoint_questions`.
 *
 *   mcq   — `answer` is the index of the correct choice; the response is the
 *           chosen index (a numeric string is accepted too).
 *   short — `answer` is the accepted answer or a list of them; compared
 *           trimmed, case-insensitive, with internal whitespace collapsed.
 */
import type { CheckpointAnswer, CheckpointKind } from '@/lib/types';

/** Share of correct answers needed to pass a module checkpoint. */
export const CHECKPOINT_PASS_RATIO = 0.7;

export interface GradableCheckpointQuestion {
  id: string;
  kind: CheckpointKind;
  answer: CheckpointAnswer;
}

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isCheckpointAnswerCorrect(q: GradableCheckpointQuestion, response: unknown): boolean {
  if (q.kind === 'mcq') {
    const chosen = typeof response === 'string' && response.trim() !== '' ? Number(response) : response;
    return typeof chosen === 'number' && chosen === q.answer;
  }
  if (typeof response !== 'string') return false;
  const accepted = Array.isArray(q.answer) ? q.answer : [String(q.answer)];
  return accepted.some((a) => normalizeText(a) === normalizeText(response));
}

export interface CheckpointGrade {
  score: number;
  total: number;
  passed: boolean;
  /** questionId → correct */
  results: Record<string, boolean>;
}

/** Grade a whole checkpoint. `responses` maps question id → the learner's answer. */
export function gradeCheckpoint(
  questions: readonly GradableCheckpointQuestion[],
  responses: Readonly<Record<string, unknown>>,
  passRatio = CHECKPOINT_PASS_RATIO
): CheckpointGrade {
  const results: Record<string, boolean> = {};
  for (const q of questions) results[q.id] = isCheckpointAnswerCorrect(q, responses[q.id]);
  const score = Object.values(results).filter(Boolean).length;
  const total = questions.length;
  return { score, total, passed: total > 0 && score / total >= passRatio, results };
}
