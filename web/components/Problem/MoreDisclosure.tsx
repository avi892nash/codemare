'use client';

import { useId, useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import s from './Problem.module.css';

interface MoreDisclosureProps {
  /** What is inside, in a few words ("2 more examples, constraints") — shown beside the toggle while it is closed. */
  hint?: string;
  children: ReactNode;
}

/**
 * "More": the part of a statement a phone reads second (further examples,
 * constraints, tags, companies). On a phone (narrow, or short) it is closed
 * behind one 44 px toggle; on a tablet upright and up the toggle is gone and
 * everything is simply there —
 * decided in CSS, so a desktop paints it open and nothing jumps after
 * hydration. The content is rendered by the server and handed in as children.
 */
export function MoreDisclosure({ hint, children }: MoreDisclosureProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={s.more} data-open={open}>
      <button type="button" className={`${s.moreToggle} focus-ring`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={16} />
        <span className={s.moreLabel}>{open ? 'Less' : 'More'}</span>
        {!open && hint && <span className={s.moreHint}>{hint}</span>}
      </button>
      <div id={bodyId} className={s.moreBody}>
        {children}
      </div>
    </div>
  );
}
