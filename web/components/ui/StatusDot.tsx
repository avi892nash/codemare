import { Icon } from './Icon';

/* Round indicator used in the catalog row. */
export type ProblemStatus = 'solved' | 'attempted' | 'unsolved';

export function StatusDot({ status }: { status: ProblemStatus }) {
  if (status === 'solved')    return <Icon name="check-circle" size={16} style={{ color: 'var(--ok)' }} />;
  if (status === 'attempted') return <Icon name="half-circle"  size={16} style={{ color: 'var(--warn)' }} />;
  return <Icon name="circle" size={16} style={{ color: 'var(--fg-4)' }} strokeWidth={1.5} />;
}
