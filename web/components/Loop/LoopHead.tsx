import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import s from './loopHead.module.css';

export interface StatItem {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  testId?: string;
}

/** Page header: eyebrow, title, one line of context, and stat tiles on the right. */
export function LoopHero({
  icon,
  eyebrow,
  title,
  subtitle,
  stats,
  titleId,
}: {
  icon: IconName;
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  stats?: StatItem[];
  titleId?: string;
}) {
  return (
    <header className={s.hero}>
      <div className={s.heroText}>
        <span className={s.eyebrow}>
          <Icon name={icon} size={13} /> {eyebrow}
        </span>
        <h1 className={s.title} id={titleId}>
          {title}
        </h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {stats && stats.length > 0 && (
        <dl className={s.stats}>
          {stats.map((st) => (
            <div key={st.label} className={s.stat}>
              <dt className={s.statLabel}>{st.label}</dt>
              <dd className="mono" data-testid={st.testId}>
                <span className={s.statValue}>{st.value}</span>
                {st.unit != null && <span className={s.statUnit}>{st.unit}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
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
