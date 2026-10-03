'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FIRST_RUN_COOKIE } from './firstRunCookie';
import s from './map.module.css';

/**
 * The map's first-run card: while a learner has solved nothing, three short
 * steps in the page's own words — solve problems, earn tokens, spend them —
 * above the tiers, and a button to dismiss it for good. The page renders it
 * only for a learner with no solved problem who has not dismissed it (the
 * dismissal is a cookie, so the SERVER knows: no flash of a card that was
 * dismissed, no layout shift, nothing for hydration to disagree about) — and
 * it is gone for good with the first solve, dismissed or not.
 */
export function FirstRun() {
  const [gone, setGone] = useState(false);
  if (gone) return null;

  const dismiss = () => {
    try {
      document.cookie = `${FIRST_RUN_COOKIE}=hide; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked: it is gone for this visit and will be back on the next
    }
    setGone(true);
    // the button is about to leave the page: hand focus to the hero's button, which is just above
    document.getElementById('map-hero-cta')?.focus();
  };

  return (
    <section className={s.firstRun} aria-label="How it works" data-testid="first-run">
      <ol className={s.steps}>
        <li>
          <span className={`${s.stepNum} mono`} aria-hidden="true">
            1
          </span>
          Solve problems
        </li>
        <li>
          <span className={`${s.stepNum} mono`} aria-hidden="true">
            2
          </span>
          Earn tokens — 1, 2 or 3 for Easy, Medium, Hard
        </li>
        <li>
          <span className={`${s.stepNum} mono`} aria-hidden="true">
            3
          </span>
          Spend them to unlock topics and open tiers
        </li>
      </ol>
      <Button variant="default" size="sm" onClick={dismiss} data-testid="first-run-dismiss">
        Got it
      </Button>
    </section>
  );
}
