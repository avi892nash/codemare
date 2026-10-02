'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/ui/Icon';
import { useMounted, useReducedMotion } from '@/components/ui/hooks';
import { LOOP_MS, animationsPlay, canRotate, keyToIndex, stepIndex, type ReelFlags } from '@/lib/client/heroReel';
import st from './stage.module.css';
import r from './heroReel.module.css';

/** How long the scene that is leaving stays mounted (frozen) while it fades out. Keep in sync with kLayerOut. */
const EXIT_MS = 420;

export interface ReelTopic {
  slug: string;
  title: string;
  caption: string;
  /** CSS value of the topic's hue (an --art-* token). */
  hue: string;
}

/**
 * How far into its loop the server-rendered first scene already is when the
 * page hydrates, so the first hand-over to the next topic still lands on a
 * loop boundary. Reads the scene's own CSS animation clock; 0 if unavailable.
 */
function loopPhaseMs(root: HTMLElement | null): number {
  if (!root || typeof root.getAnimations !== 'function') return 0;
  for (const an of root.getAnimations({ subtree: true })) {
    const t = an.effect?.getComputedTiming();
    if (t && t.duration === LOOP_MS && t.delay === 0 && typeof an.currentTime === 'number') return an.currentTime % LOOP_MS;
  }
  return 0;
}

/**
 * The sign-in hero: one topic scene at a time on a stage, cycling through the
 * topics, with the topic's name and a one-line caption under it.
 *
 *  - Only the active scene is mounted (the scenes arrive as server-rendered
 *    props, so they ship no client JS); switching mounts the next one and
 *    cross-fades the old one out, frozen.
 *  - The "timer" is a CSS animation filling the active segment of the switcher
 *    (one loop long). Pausing it is `animation-play-state`, and its end moves
 *    the reel on, so the segment bar always shows what will happen. Holds
 *    (lib/client/heroReel.ts): the pause button, a mouse over the reel, keyboard
 *    focus inside it, a hidden tab, scrolled out of view, reduced motion.
 *  - The switcher is a toolbar of buttons with one tab stop and arrow-key
 *    roving focus. The art is decoration (aria-hidden); the visible name and
 *    caption say what is on, and there is no live region.
 *  - Nothing moves when the topic changes: the stage keeps its aspect ratio and
 *    the topics' texts share one grid cell (the cell is as tall as the longest
 *    at the current width), so a wrapped caption cannot push the form down.
 * The first topic is fixed, so the server and the first client render agree.
 */
export function HeroReel({ topics, scenes }: { topics: ReelTopic[]; scenes: Record<string, ReactNode> }) {
  const n = topics.length;
  const [view, setView] = useState<{ cur: number; prev: number | null; dir: 1 | -1; switched: boolean }>({
    cur: 0,
    prev: null,
    dir: 1,
    switched: false,
  });
  const [userPaused, setUserPaused] = useState(false);
  const [pointerOver, setPointerOver] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [offScreen, setOffScreen] = useState(false);
  const [boot, setBoot] = useState<{ phase: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const mounted = useMounted();
  const flags: ReelFlags = { userPaused, pointerOver, keyboardFocus, pageHidden, offScreen, reducedMotion };
  const rotating = mounted && boot !== null && canRotate(flags);
  const playing = animationsPlay(flags);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rotatingRef = useRef(rotating);
  rotatingRef.current = rotating;

  const go = useCallback((i: number, dir?: 1 | -1) => {
    setView((v) => (i === v.cur ? v : { cur: i, prev: v.cur, dir: dir ?? (i > v.cur ? 1 : -1), switched: true }));
  }, []);

  // Once hydrated: note where the first scene's loop is, then start the timer.
  useEffect(() => setBoot({ phase: loopPhaseMs(stageRef.current) }), []);

  // The scene that is leaving goes away once its fade is done.
  useEffect(() => {
    if (view.prev === null) return;
    const t = setTimeout(() => setView((v) => (v.prev === null ? v : { ...v, prev: null })), EXIT_MS);
    return () => clearTimeout(t);
  }, [view.prev, view.cur]);

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.hidden);
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOffScreen(!entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onDwellEnd = (e: AnimationEvent<HTMLSpanElement>) => {
    if (e.target !== e.currentTarget || !rotatingRef.current) return;
    go(stepIndex(view.cur, n, 1), 1);
  };

  const onSwitcherKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from = Math.max(0, segRefs.current.findIndex((b) => b === document.activeElement));
    const to = keyToIndex(e.key, from, n);
    if (to === null) return;
    e.preventDefault();
    segRefs.current[to]?.focus();
    go(to);
  };

  // Keyboard focus holds the rotation; a mouse click on a segment does not (it would stall the reel for good).
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    let visible = false;
    try {
      visible = (e.target as HTMLElement).matches(':focus-visible');
    } catch {
      /* very old browsers: treat as mouse focus */
    }
    setKeyboardFocus(visible);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
  };

  const cur = topics[view.cur];
  const layer = (i: number, state: 'rest' | 'in' | 'out') => {
    const t = topics[i];
    return (
      <div key={t.slug} className={`${st.hue} ${r.layer}`} data-state={state} style={{ '--a': t.hue, '--dir': view.dir } as CSSProperties}>
        {scenes[t.slug]}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={r.reel}
      data-testid="hero-reel"
      data-topic={cur.slug}
      data-live={mounted && boot ? '' : undefined}
      data-hold={rotating ? undefined : ''}
      style={{ '--dwell': `${LOOP_MS}ms` } as CSSProperties}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setPointerOver(true);
      }}
      onPointerLeave={() => setPointerOver(false)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div
        ref={stageRef}
        className={`${st.stage} ${st.hue} ${r.stage}`}
        style={{ '--a': cur.hue, '--L': `${LOOP_MS}ms` } as CSSProperties}
        data-paused={playing ? undefined : ''}
      >
        <div className={r.layers} aria-hidden="true" data-testid="hero-layers">
          {view.prev !== null && layer(view.prev, 'out')}
          {layer(view.cur, view.switched ? 'in' : 'rest')}
        </div>

        <div role="toolbar" aria-label="Topics" aria-orientation="horizontal" className={r.segs} onKeyDown={onSwitcherKeyDown}>
          {topics.map((t, i) => {
            const active = i === view.cur;
            return (
              <button
                key={t.slug}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                type="button"
                className={`${r.seg} focus-ring`}
                style={{ '--seg': t.hue } as CSSProperties}
                aria-label={`Show ${t.title.toLowerCase()}`}
                aria-current={active ? 'true' : undefined}
                tabIndex={active ? 0 : -1}
                onClick={() => go(i)}
              >
                <span className={r.segBar}>
                  {active && (
                    <span
                      key={t.slug}
                      className={r.fill}
                      style={!view.switched && boot ? { animationDelay: `${-boot.phase}ms` } : undefined}
                      onAnimationEnd={onDwellEnd}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={r.meta} style={{ '--a': cur.hue } as CSSProperties}>
        {/* Every topic's text sits in the same grid cell and only the current one shows, so the cell is as tall
            as the longest of them at this width and a long title or a wrapped caption never moves the page. */}
        <div className={r.text}>
          {topics.map((t, i) => {
            const on = i === view.cur;
            return (
              <div key={t.slug} className={r.slot} data-on={on ? '' : undefined} aria-hidden={on ? undefined : true}>
                <p className={r.name} data-testid={on ? 'hero-title' : undefined}>
                  {t.title}
                </p>
                <p className={r.caption} data-testid={on ? 'hero-caption' : undefined}>
                  {t.caption}
                </p>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={`${r.pause} focus-ring`}
          aria-label={userPaused ? 'Play animation' : 'Pause animation'}
          data-testid="hero-pause"
          onClick={() => setUserPaused((p) => !p)}
        >
          <Icon name={userPaused ? 'play' : 'pause'} size={15} />
        </button>
      </div>
    </div>
  );
}
