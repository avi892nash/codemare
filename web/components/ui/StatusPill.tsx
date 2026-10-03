import type { CSSProperties } from 'react';
import { Pill, pillIconSize, type PillTone, type PillSize } from './Pill';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

export type StatusCode = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX' | 'PND';
/** Final judge verdicts (architecture §2 `Verdict`). */
export type Verdict = Exclude<StatusCode, 'PND'>;

export const VERDICTS: readonly Verdict[] = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX'] as const;

/* Colors per architecture §8: OK → ok, WA/RE → err, TLE/MLE → warn,
 * CE → info, XX → neutral. PND (queued / compiling / running) → accent.
 * The long names are sentence case, as in the result card (Accepted, Wrong
 * answer, Time limit exceeded); the short codes are the small secondary label. */
export const STATUS_META: Record<StatusCode, { tone: PillTone; long: string; icon: IconName }> = {
  OK:  { tone: 'ok',     long: 'Accepted',              icon: 'check' },
  WA:  { tone: 'err',    long: 'Wrong answer',          icon: 'x' },
  TLE: { tone: 'warn',   long: 'Time limit exceeded',   icon: 'clock' },
  MLE: { tone: 'warn',   long: 'Memory limit exceeded', icon: 'memory' },
  RE:  { tone: 'err',    long: 'Runtime error',         icon: 'alert' },
  CE:  { tone: 'info',   long: 'Compilation error',     icon: 'code' },
  XX:  { tone: 'muted',  long: 'Internal error',        icon: 'alert-circle' },
  PND: { tone: 'accent', long: 'Pending',               icon: 'clock' },
};

export function isStatusCode(value: unknown): value is StatusCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_META, value);
}

/** Long label for a code ("TLE" → "Time limit exceeded"); unknown → Internal error. */
export function statusLabel(code: string): string {
  return isStatusCode(code) ? STATUS_META[code].long : STATUS_META.XX.long;
}

interface StatusPillProps {
  code: StatusCode;
  size?: PillSize;
  /** Show "Wrong Answer" instead of "WA". */
  showLong?: boolean;
  /** Custom text (e.g. "Compiling" for PND). Screen readers still get it. */
  label?: string;
  /** Leading status icon (a spinner for PND) — helps when color is not seen. */
  withIcon?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Verdict capsule. Short codes render in mono with the long name available
 * to screen readers, so "TLE" is announced as "Time limit exceeded".
 */
export function StatusPill({ code, size = 'sm', showLong = false, label, withIcon = false, className, style }: StatusPillProps) {
  const m = STATUS_META[code] ?? STATUS_META.XX;
  const iz = pillIconSize(size);
  const text = label ?? (showLong ? m.long : code);
  const needsSrLong = !label && !showLong;
  return (
    <Pill
      tone={m.tone}
      size={size}
      className={`mono ${className ?? ''}`.trim()}
      style={{ fontFamily: 'var(--font-mono)', letterSpacing: 0.2, ...style }}
      title={m.long}
    >
      {withIcon && (code === 'PND' ? <Spinner size={iz} /> : <Icon name={m.icon} size={iz} />)}
      {needsSrLong ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{m.long}</span>
        </>
      ) : (
        text
      )}
    </Pill>
  );
}
