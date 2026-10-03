import { Icon, type IconName } from '@/components/ui/Icon';
import s from './map.module.css';

/**
 * The map's whole status vocabulary: Open · Ready to unlock · Locked. One
 * treatment each, wherever it appears (a tier's header, a topic's row), and
 * only where it matters — an unlocked topic in an open tier says nothing,
 * and the topics of a closed tier leave it to the tier.
 */
export type StateKind = 'open' | 'ready' | 'locked';

const META: Record<StateKind, { text: string; icon: IconName }> = {
  open: { text: 'Open', icon: 'lock-open' },
  ready: { text: 'Ready to unlock', icon: 'sparkle' },
  locked: { text: 'Locked', icon: 'lock' },
};

export function StateLabel({ kind, 'data-testid': testId }: { kind: StateKind; 'data-testid'?: string }) {
  const m = META[kind];
  return (
    <span className={s.state} data-kind={kind} data-testid={testId}>
      <Icon name={m.icon} size={12} />
      {m.text}
    </span>
  );
}
