import { Pill, type PillTone, type PillSize } from './Pill';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

const TONE: Record<Difficulty, PillTone> = {
  Easy:   'ok',
  Medium: 'warn',
  Hard:   'err',
};

export function DifficultyPill({ level, size = 'sm' }: { level: Difficulty; size?: PillSize }) {
  return <Pill tone={TONE[level]} size={size}>{level}</Pill>;
}
