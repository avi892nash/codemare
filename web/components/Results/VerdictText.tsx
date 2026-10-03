import { Icon, type IconName } from '@/components/ui/Icon';
import { isStatusCode, type StatusCode } from '@/components/ui/StatusPill';
import { verdictTitle } from '@/lib/client/resultCopy';
import type { Verdict } from '@/lib/types';
import s from './VerdictText.module.css';

type Tone = 'ok' | 'err' | 'warn' | 'info' | 'muted';

/** The result card's own look per verdict (the same tones and glyphs as ResultsHero), for where a verdict is listed rather than headlined. */
const LOOK: Record<StatusCode, { tone: Tone; icon: IconName }> = {
  OK: { tone: 'ok', icon: 'check-circle' },
  WA: { tone: 'err', icon: 'x' },
  RE: { tone: 'err', icon: 'alert' },
  TLE: { tone: 'warn', icon: 'clock' },
  MLE: { tone: 'warn', icon: 'memory' },
  CE: { tone: 'info', icon: 'code' },
  XX: { tone: 'muted', icon: 'alert-circle' },
  PND: { tone: 'muted', icon: 'clock' },
};

/**
 * "Accepted", "Wrong answer", "Time limit exceeded" … in sentence case with the
 * verdict's glyph and tone, and the short code (OK, WA, TLE …) as a small
 * secondary label — the vocabulary of the result card, without a second set of
 * pills for the same idea. Anything that is not a verdict yet reads "Pending".
 */
export function VerdictText({ status }: { status: string }) {
  const code: StatusCode = isStatusCode(status) ? status : 'PND';
  const look = LOOK[code];
  return (
    <span className={s.verdict} data-tone={look.tone}>
      <Icon name={look.icon} size={12} strokeWidth={2} />
      <span>{code === 'PND' ? 'Pending' : verdictTitle(code as Verdict, 'submit')}</span>
      {code !== 'PND' && (
        <span className={s.code} aria-hidden="true">
          {code}
        </span>
      )}
    </span>
  );
}
