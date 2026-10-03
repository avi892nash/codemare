import type { ReactNode } from 'react';
import { StatusDot, type ProblemStatus } from '@/components/ui/StatusDot';
import type { LessonState } from '@/lib/server/rules/learnProgress';
import type { TrackLevel } from '@/lib/types';
import s from './learn.module.css';

/** Scrollable page + centered column, inside the workspace layout (the same width and padding as the map). */
export function PageShell({ children, narrow = false, label }: { children: ReactNode; narrow?: boolean; label?: string }) {
  return (
    <main className={`${s.page} scroll`} aria-label={label}>
      <div className={[s.container, narrow && s.narrow].filter(Boolean).join(' ')}>{children}</div>
    </main>
  );
}

export const LEVEL_LABEL: Record<TrackLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const STATE: Record<LessonState | 'failed', { status: ProblemStatus; label: string }> = {
  completed: { status: 'solved', label: 'Completed' },
  started: { status: 'attempted', label: 'In progress' },
  not_started: { status: 'unsolved', label: 'Not started' },
  failed: { status: 'attempted', label: 'Not passed yet' },
};

/**
 * Where a lesson or checkpoint stands, with the map's progress glyphs (done · half · open), and its meaning for
 * screen readers (colour is never the only cue).
 */
export function StateIcon({ state }: { state: LessonState | 'failed' }) {
  const m = STATE[state];
  return (
    <span className={s.stateIcon}>
      <StatusDot status={m.status} />
      <span className="sr-only">{m.label}</span>
    </span>
  );
}

/** Durations never break between number and unit (non-breaking spaces). */
export function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function hours(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
}

/** "3 lessons" · "1 lesson". */
export const lessonsLabel = (n: number): string => `${n} lesson${n === 1 ? '' : 's'}`;

/** A section's title (sentence case) with an optional quiet note at its right. */
export function SectionHead({ title, note, id, children }: { title: string; note?: ReactNode; id?: string; children?: ReactNode }) {
  return (
    <div className={s.sectionHead}>
      <h2 className={s.sectionTitle} id={id}>
        {title}
      </h2>
      {note && <span className={s.sectionNote}>{note}</span>}
      {children}
    </div>
  );
}
