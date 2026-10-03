import type { Difficulty } from '@/lib/types';
import s from './DifficultyText.module.css';

/**
 * Easy · Medium · Hard as quiet text with a small dot — information a learner
 * preparing wants, not a traffic light. The one way difficulty is shown on a
 * page that lists problems; use `DifficultyPill` only where a filled tag is the
 * point (e.g. the editor's title row).
 */
export function DifficultyText({ level }: { level: Difficulty }) {
  return (
    <span className={s.diff} data-level={level}>
      {level}
    </span>
  );
}
