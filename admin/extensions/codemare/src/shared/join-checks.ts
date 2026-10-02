/**
 * Checks for the join tables staff edit in Directus — question topics and
 * gate questions. Pure; the content-integrity hook feeds them rows and turns
 * problems into readable 400s. Unit-tested in admin/test/join-checks.test.ts.
 * Messages carry no final period: Directus renders them as
 * "Invalid payload. <message>.".
 *
 * They mirror the seed validator (web/prisma/seed/validate.ts), so Directus
 * cannot store what the seed would refuse:
 *   · a question topic's weight is a number > 0 (also a CHECK constraint)
 *   · a gate keeps at least `pass_threshold` questions
 */

export const WEIGHT_MESSAGE =
  'Weight must be a number greater than 0: the share of the solve award this topic gets (1 = the full award)';

/** A question topic weight: a finite number > 0 (numeric strings accepted, as Directus may send them). */
export function isValidWeight(value: unknown): boolean {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * How many questions a gate has after a write to its `questions` O2M alias:
 * `change` is either the full new list (ids or items) or Directus' nested
 * `{ create, update, delete }` alterations. `current` are the ids it has now.
 * An update of a row that is not the gate's yet moves it into the gate.
 */
export function gateQuestionCountAfter(current: readonly string[], change: unknown): number {
  if (change === undefined || change === null) return current.length;
  if (Array.isArray(change)) return change.length;
  if (typeof change !== 'object') return current.length;
  const { create, update, delete: remove } = change as { create?: unknown[]; update?: { id?: unknown }[]; delete?: unknown[] };
  const mine = new Set(current);
  const moved = (update ?? []).filter((u) => typeof u?.id === 'string' && !mine.has(u.id)).length;
  const removed = new Set((remove ?? []).filter((k): k is string => typeof k === 'string' && mine.has(k))).size;
  return current.length + (create?.length ?? 0) + moved - removed;
}

export function gateThresholdProblem(gateTitle: string, passThreshold: number, questionCount: number): string | null {
  if (questionCount >= passThreshold) return null;
  return (
    `Gate “${gateTitle}” needs ${passThreshold} passed question${passThreshold === 1 ? '' : 's'} but would have ` +
    `${questionCount}, so nobody could ever pass it. Keep at least ${passThreshold} questions or lower its pass threshold`
  );
}
