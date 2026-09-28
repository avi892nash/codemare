import type { TestEventData } from '@/lib/sse';
import s from './Results.module.css';

interface TestStripProps {
  /** Tests judged so far (any order). */
  tests: TestEventData[];
  /** Total expected, when known — the rest draw as pending. */
  total: number | null;
  /** Mark the pending tick after the last result as the one running. */
  live?: boolean;
  onSelect?: (idx: number) => void;
}

/**
 * One tick per test — pending, passed or failed — filling in as `test`
 * events arrive. Decorative for screen readers (the caller states the
 * count in text).
 */
export function TestStrip({ tests, total, live = false, onSelect }: TestStripProps) {
  const byIdx = new Map(tests.map((t) => [t.idx, t]));
  const n = Math.max(total ?? 0, tests.length ? Math.max(...tests.map((t) => t.idx)) + 1 : 0);
  if (n === 0) return null;
  const firstPending = Array.from({ length: n }, (_, i) => i).find((i) => !byIdx.has(i));
  return (
    <div className={s.strip} aria-hidden="true" data-testid="test-strip">
      {Array.from({ length: n }, (_, i) => {
        const t = byIdx.get(i);
        const state = t ? (t.passed ? 'pass' : 'fail') : live && i === firstPending ? 'current' : 'pending';
        const title = t ? `Test ${i + 1}${t.hidden ? ' (hidden)' : t.custom ? ' (custom)' : ''}: ${t.passed ? 'passed' : 'failed'}` : `Test ${i + 1}`;
        return onSelect && t ? (
          <button key={i} type="button" tabIndex={-1} className={s.tick} data-state={state} title={title} onClick={() => onSelect(i)} />
        ) : (
          <span key={i} className={s.tick} data-state={state} title={title} />
        );
      })}
    </div>
  );
}
