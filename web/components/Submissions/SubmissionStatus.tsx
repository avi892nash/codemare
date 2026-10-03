import { Icon, type IconName } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import type { SubmissionKind, SubmissionStatus as Status, Verdict } from '@/lib/types';
import { statusWord } from './format';
import s from './Submissions.module.css';

/** The verdict's tone and glyph — the same as the result card's. */
export const VERDICT_LOOK: Record<Verdict, { tone: 'ok' | 'err' | 'warn' | 'info' | 'muted'; icon: IconName }> = {
  OK: { tone: 'ok', icon: 'check-circle' },
  WA: { tone: 'err', icon: 'x' },
  RE: { tone: 'err', icon: 'alert' },
  TLE: { tone: 'warn', icon: 'clock' },
  MLE: { tone: 'warn', icon: 'memory' },
  CE: { tone: 'info', icon: 'code' },
  XX: { tone: 'muted', icon: 'alert-circle' },
};

/**
 * A submission's status in the words of the result card — Accepted, Wrong answer, Time limit exceeded — with the
 * short code (OK · WA · TLE …) as a small secondary label. Queued and running read as such, with a spinner.
 */
export function SubmissionStatus({ status, kind }: { status: Status; kind: SubmissionKind }) {
  if (status === 'queued' || status === 'running') {
    return (
      <span className={s.status} data-tone="pending">
        <Spinner size={12} />
        {statusWord(status, kind)}
      </span>
    );
  }
  const look = VERDICT_LOOK[status];
  return (
    <span className={s.status} data-tone={look.tone}>
      <Icon name={look.icon} size={12} strokeWidth={2} />
      <span>{statusWord(status, kind)}</span>
      <span className={`${s.code} mono`} aria-hidden="true">
        {status}
      </span>
    </span>
  );
}
