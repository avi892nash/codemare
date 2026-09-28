import type { CSSProperties } from 'react';
import { Pill, type PillTone, type PillSize } from './Pill';
import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

export type StatusCode = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX' | 'PND';
/** Final judge verdicts (architecture §2 `Verdict`). */
export type Verdict = Exclude<StatusCode, 'PND'>;

export const VERDICTS: readonly Verdict[] = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX'] as const;

/* Colors per architecture §8: OK → ok, WA/RE → err, TLE/MLE → warn,
 * CE → info, XX → neutral. PND (queued / compiling / running) → accent. */
export const STATUS_META: Record<StatusCode, { tone: PillTone; long: string; icon: IconName }> = {
  OK:  { tone: 'ok',     long: 'Accepted',              icon: 'check' },
  WA:  { tone: 'err',    long: 'Wrong Answer',          icon: 'x' },
  TLE: { tone: 'warn',   long: 'Time Limit Exceeded',   icon: 'clock' },
  MLE: { tone: 'warn',   long: 'Memory Limit Exceeded', icon: 'memory' },
  RE:  { tone: 'err',    long: 'Runtime Error',         icon: 'alert' },
  CE:  { tone: 'info',   long: 'Compilation Error',     icon: 'code' },
  XX:  { tone: 'muted',  long: 'Internal Error',        icon: 'alert-circle' },
  PND: { tone: 'accent', long: 'Pending',               icon: 'clock' },
};

export function isStatusCode(value: unknown): value is StatusCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS_META, value);
}

/** Long label for a code ("TLE" → "Time Limit Exceeded"); unknown → Internal Error. */
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
 * to screen readers, so "TLE" is announced as "Time Limit Exceeded".
 */
export function StatusPill({ code, size = 'sm', showLong = false, label, withIcon = false, className, style }: StatusPillProps) {
  const m = STATUS_META[code] ?? STATUS_META.XX;
  const iz = size === 'xs' ? 10.5 : size === 'md' ? 12.5 : 11.5;
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
