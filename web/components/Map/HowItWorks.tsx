'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { FIRST_RUN_COOKIE } from './firstRunCookie';
import s from './map.module.css';

/**
 * "How it works": the map's three steps — solve problems, earn tokens, spend
 * them — as a card under the hero, and a quiet link in the header that brings
 * it back. One disclosure with two ends, so the provider holds the state:
 *
 *  - while a learner has solved nothing and has not dismissed it, the page
 *    renders it open (the dismissal is a cookie, so the SERVER knows: no flash
 *    of a card that was dismissed, no layout shift, nothing for hydration to
 *    disagree about) and "Got it" puts it away for good;
 *  - the first solve takes it away for good, dismissed or not — but the link
 *    ("How it works", at the end of the header's line of progress) opens it
 *    again for as long as the learner likes, in the page, with no round trip;
 *    a second press, or "Got it", closes it.
 */
interface State {
  open: boolean;
  /** It was opened by the link (not rendered open by the server). */
  viaLink: boolean;
}
interface HowItWorksApi extends State {
  toggle: () => void;
  dismiss: () => void;
}
const Ctx = createContext<HowItWorksApi | null>(null);
const CARD_ID = 'how-it-works';
const TOGGLE_ID = 'how-it-works-toggle';

export function HowItWorks({ initialOpen, children }: { initialOpen: boolean; children: ReactNode }) {
  const [state, setState] = useState<State>({ open: initialOpen, viaLink: false });
  const current = useRef(state);
  current.current = state;
  // Where focus goes once the card has left the page (it would fall to the document otherwise).
  const focusAfter = useRef<string | null>(null);

  const toggle = useCallback(() => {
    const { open } = current.current;
    focusAfter.current = open ? TOGGLE_ID : null;
    setState({ open: !open, viaLink: !open });
  }, []);

  const dismiss = useCallback(() => {
    try {
      const secure = window.location.protocol === 'https:' ? '; secure' : '';
      document.cookie = `${FIRST_RUN_COOKIE}=hide; path=/; max-age=31536000; samesite=lax${secure}`;
    } catch {
      // cookies blocked: it is gone for this visit and will be back on the next
    }
    // the button is about to leave the page: focus goes to the link that brought the card, or to the hero's button, which is just above
    focusAfter.current = current.current.viaLink ? TOGGLE_ID : 'map-hero-cta';
    setState({ open: false, viaLink: false });
  }, []);

  useEffect(() => {
    if (state.open || !focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [state.open]);

  const api = useMemo(() => ({ ...state, toggle, dismiss }), [state, toggle, dismiss]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useHowItWorks(): HowItWorksApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('The parts of “How it works” belong inside <HowItWorks>');
  return api;
}

/** The link at the end of the header's line of progress. */
export function HowItWorksToggle() {
  const { open, toggle } = useHowItWorks();
  return (
    <button type="button" id={TOGGLE_ID} className={`${s.howLink} focus-ring`} aria-expanded={open} aria-controls={CARD_ID} onClick={toggle} data-testid="how-it-works-toggle">
      How it works
    </button>
  );
}

/** The card: three steps and a button to be done with it. Nothing is rendered while it is closed. */
export function HowItWorksCard() {
  const { open, viaLink, dismiss } = useHowItWorks();
  const card = useRef<HTMLElement>(null);

  // Opened by the link: bring it into view — under the hero, it is below the fold on a phone — and name it to a screen reader.
  useEffect(() => {
    const el = card.current;
    if (!open || !viaLink || !el) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [open, viaLink]);

  if (!open) return null;
  return (
    <section ref={card} id={CARD_ID} tabIndex={-1} className={s.firstRun} aria-label="How it works" data-testid="first-run">
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
