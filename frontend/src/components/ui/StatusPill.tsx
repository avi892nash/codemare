import { Pill, type PillTone, type PillSize } from './Pill';

export type StatusCode = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX' | 'PND';

export const STATUS_META: Record<StatusCode, { tone: PillTone; long: string }> = {
  OK:  { tone: 'ok',    long: 'Accepted' },
  WA:  { tone: 'warn',  long: 'Wrong Answer' },
  TLE: { tone: 'err',   long: 'Time Limit Exceeded' },
  MLE: { tone: 'err',   long: 'Memory Limit Exceeded' },
  RE:  { tone: 'err',   long: 'Runtime Error' },
  CE:  { tone: 'err',   long: 'Compilation Error' },
  XX:  { tone: 'muted', long: 'Internal Error' },
  PND: { tone: 'info',  long: 'Pending' },
};

export function StatusPill({
  code, size = 'sm', showLong = false,
}: { code: StatusCode; size?: PillSize; showLong?: boolean }) {
  const m = STATUS_META[code] ?? STATUS_META.XX;
  return (
    <Pill tone={m.tone} size={size} className="mono" style={{ fontFamily: 'var(--font-mono)', letterSpacing: 0.2 }}>
      {showLong ? m.long : code}
    </Pill>
  );
}
