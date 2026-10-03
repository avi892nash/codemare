import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { statusLabel } from '@/components/ui/StatusPill';
import { isVerdict, VERDICT_LOOK, verdictTitle } from '@/lib/client/resultCopy';
import type { SubmissionKind } from '@/lib/types';
import s from './VerdictText.module.css';

interface VerdictTextProps {
  /** A verdict (OK · WA · TLE …), or a state before one: queued, running — anything else reads "Pending". */
  status: string;
  /** What kind of run it was: a run that passed reads "All tests passed", a submit "Accepted". */
  kind?: SubmissionKind;
  /** Other words for the verdict (the playground says "All matched" and "Mismatch"). */
  label?: string;
  /** The short code (OK, WA, TLE …) as a small secondary label after the words. Defaults to on, and to off when `label` is given. */
  showCode?: boolean;
  /**
   * `words` (the default): the glyph, the verdict in words, the code small. `code`: the glyph and the code alone, for a
   * dense row (a playground case) — the words stay in the title and for screen readers.
   */
  variant?: 'words' | 'code';
  /** `sm` (13 px, the default) in lists; `md` (14 px) where it leads a block (the playground's summary). */
  size?: 'sm' | 'md';
}

/** "Queued" · "Running" · "Pending": a state before a verdict. */
function pendingWord(status: string): string {
  return status === 'queued' ? 'Queued' : status === 'running' ? 'Running' : 'Pending';
}

/**
 * A verdict as quiet text — the one way a verdict is shown wherever it is listed rather than headlined (a submission
 * row, the profile, the editor's Submissions tab, the playground's output, a lesson's runnable snippet): its glyph and
 * its name in the verdict's own tone, in sentence case ("Accepted", "Wrong answer", "Time limit exceeded"), with the
 * short code (OK, WA, TLE …) as a small secondary label. No capsule: it is the result card's vocabulary, not a second
 * set of pills for the same idea. A state before a verdict shows a spinner.
 */
export function VerdictText({ status, kind = 'submit', label, showCode, variant = 'words', size = 'sm' }: VerdictTextProps) {
  if (!isVerdict(status)) {
    return (
      <span className={s.verdict} data-tone="pending" data-size={size}>
        <Spinner size={12} />
        <span>{label ?? pendingWord(status)}</span>
      </span>
    );
  }
  const look = VERDICT_LOOK[status];
  const words = verdictTitle(status, kind === 'run' ? 'run' : 'submit');
  if (variant === 'code') {
    return (
      <span className={s.verdict} data-tone={look.tone} data-size={size} title={statusLabel(status)}>
        <Icon name={look.icon} size={12} strokeWidth={2} />
        <span className={`${s.codeOnly} mono`} aria-hidden="true">
          {status}
        </span>
        <span className="sr-only">{statusLabel(status)}</span>
      </span>
    );
  }
  return (
    <span className={s.verdict} data-tone={look.tone} data-size={size}>
      <Icon name={look.icon} size={size === 'md' ? 14 : 12} strokeWidth={2} />
      <span>{label ?? words}</span>
      {(showCode ?? !label) && (
        <span className={`${s.code} mono`} data-verdict-code="" aria-hidden="true">
          {status}
        </span>
      )}
    </span>
  );
}
