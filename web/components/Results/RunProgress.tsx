import { ProgressBar } from '@/components/ui/ProgressBar';
import { Spinner } from '@/components/ui/Spinner';
import type { RunPhaseState } from '@/lib/client/runState';
import type { TestEventData } from '@/lib/sse';
import { TestStrip } from './TestStrip';
import s from './Results.module.css';

interface RunProgressProps {
  phase: RunPhaseState;
  kind: 'run' | 'submit' | 'build' | null;
  tests: TestEventData[];
  total: number | null;
  language?: string;
}

const PHASE_LABEL: Partial<Record<RunPhaseState, string>> = {
  connecting: 'Sending…',
  queued: 'Queued — waiting for a sandbox…',
  compiling: 'Compiling…',
};

/** Live progress while a run streams: phase, a tick per test, a bar. */
export function RunProgress({ phase, kind, tests, total, language }: RunProgressProps) {
  const done = tests.length;
  const failed = tests.filter((t) => !t.passed).length;
  const label =
    phase === 'running'
      ? total
        ? done < total
          ? `Running test ${Math.min(done + 1, total)} of ${total}…`
          : 'Finishing…'
        : 'Running…'
      : PHASE_LABEL[phase] ?? 'Working…';
  const what = kind === 'submit' ? 'Judging your submission' : kind === 'build' ? 'Building' : 'Running the samples';
  return (
    <div className={s.progress} data-testid="run-progress">
      <div className={s.progressHead}>
        <Spinner size={15} />
        <div className={s.progressText}>
          <span className={s.progressTitle}>{what}</span>
          <span className={s.progressPhase} role="status" aria-live="polite">
            {label}
            {done > 0 && (
              <span className="mono">
                {' '}
                · {done - failed} passed{failed > 0 ? `, ${failed} failed` : ''}
              </span>
            )}
          </span>
        </div>
        {language && <span className={s.progressLang}>{language}</span>}
      </div>
      <TestStrip tests={tests} total={total} live={phase === 'running'} />
      <ProgressBar
        aria-label="Tests judged"
        value={total ? done : 0}
        max={total ?? 1}
        indeterminate={!total || phase !== 'running'}
        valueText={total ? `${done} of ${total} tests` : undefined}
        tone={failed > 0 ? 'err' : 'accent'}
        height={3}
      />
    </div>
  );
}
