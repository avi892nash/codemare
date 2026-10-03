import type { ReactNode } from 'react';
import s from './loopHead.module.css';

/** A section's heading inside a loop page: its title, and a quiet note at the right. (A page's own header is the shared PageHeader.) */
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
