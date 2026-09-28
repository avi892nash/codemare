import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { LessonState } from '@/lib/server/rules/learnProgress';
import type { TrackLevel } from '@/lib/types';
import s from './learn.module.css';

/** Scrollable page + centered column, inside the workspace layout. */
export function PageShell({ children, narrow = false, label }: { children: ReactNode; narrow?: boolean; label?: string }) {
  return (
    <main className={`${s.page} scroll`} aria-label={label}>
      <div className={[s.container, narrow && s.narrow].filter(Boolean).join(' ')}>{children}</div>
    </main>
  );
}

export const LEVEL: Record<TrackLevel, { label: string; tone: PillTone; icon: IconName }> = {
  beginner: { label: 'Beginner', tone: 'ok', icon: 'sparkle' },
  intermediate: { label: 'Intermediate', tone: 'warn', icon: 'gauge' },
  advanced: { label: 'Advanced', tone: 'err', icon: 'flame' },
};

export function LevelPill({ level, size = 'xs' }: { level: TrackLevel; size?: 'xs' | 'sm' }) {
  const l = LEVEL[level];
  return (
    <Pill tone={l.tone} size={size}>
      {l.label}
    </Pill>
  );
}

/** Icons per track, by position (content has no icon field for tracks). */
export const TRACK_ICONS: IconName[] = ['layers', 'search', 'network', 'route', 'puzzle', 'graduation'];

const STATE: Record<LessonState | 'failed', { icon: IconName; label: string }> = {
  completed: { icon: 'check-circle', label: 'Completed' },
  started: { icon: 'half-circle', label: 'In progress' },
  not_started: { icon: 'circle', label: 'Not started' },
  failed: { icon: 'alert-circle', label: 'Not passed yet' },
};

/** Status glyph with its meaning for screen readers (color is never the only cue). */
export function StateIcon({ state, size = 16 }: { state: LessonState | 'failed'; size?: number }) {
  const m = STATE[state];
  return (
    <span className={s.stateIcon} data-state={state}>
      <Icon name={m.icon} size={size} />
      <span className="sr-only">{m.label}</span>
    </span>
  );
}

export function minutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function hours(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
}

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
