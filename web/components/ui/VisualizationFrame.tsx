'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from './Button';
import { Kbd } from './Kbd';
import { Select } from './Select';
import { useReducedMotion } from './hooks';
import s from './VisualizationFrame.module.css';

const SPEEDS = [0.5, 1, 2] as const;
type Speed = (typeof SPEEDS)[number];

export interface VisualizationFrameProps<T> {
  /** Precomputed states; the frame only chooses which one to show. */
  steps: T[];
  /** Draws one state. Keep it pure — the frame re-renders it on every step. */
  render: (step: T, index: number) => ReactNode;
  /** Narration for a step: shown under the stage and announced when paused. */
  describe?: (step: T, index: number) => string;
  title?: string;
  /** Milliseconds per step at 1×. */
  interval?: number;
  /** Start playing once visible. Always off under prefers-reduced-motion. */
  autoPlay?: boolean;
  loop?: boolean;
  initialStep?: number;
  stageMinHeight?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Generic step-through player for algorithm visualizations (`:::viz{id=…}`).
 * Transport (first / prev / play-pause / next / last), a scrub slider, speed,
 * and shortcuts while focus is inside: Space/K play-pause, ←/→ (J/L) step,
 * Home/End, −/+ speed. Autoplay waits until the frame is on screen and never
 * happens under reduced motion (the learner can still press play).
 */
export function VisualizationFrame<T>({
  steps, render, describe, title, interval = 900, autoPlay = true, loop = false, initialStep = 0,
  stageMinHeight = 160, className, style,
}: VisualizationFrameProps<T>) {
  const n = steps.length;
  const last = Math.max(0, n - 1);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialStep), last));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  const clamp = useCallback((i: number) => Math.min(Math.max(0, i), last), [last]);
  const go = useCallback((i: number) => setIndex(clamp(i)), [clamp]);

  // Keep the index valid when the steps change.
  useEffect(() => setIndex((i) => clamp(i)), [clamp]);

  // Autoplay once, when first scrolled into view, unless motion is reduced.
  useEffect(() => {
    if (!autoPlay || reduced || autoStarted.current || n < 2) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !autoStarted.current) {
          autoStarted.current = true;
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [autoPlay, reduced, n]);

  // Reduced motion switched on mid-play: stop.
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  // The clock.
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      if (loop && n > 1) {
        const t = window.setTimeout(() => setIndex(0), interval / speed);
        return () => window.clearTimeout(t);
      }
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setIndex((i) => clamp(i + 1)), interval / speed);
    return () => window.clearTimeout(t);
  }, [playing, index, last, loop, n, interval, speed, clamp]);

  const togglePlay = () => {
    if (!playing && index >= last) setIndex(0);
    setPlaying((p) => !p);
  };
  const step = (d: number) => {
    setPlaying(false);
    go(index + d);
  };
  const bumpSpeed = (d: 1 | -1) => {
    const k = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, k + d))]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && (target as HTMLInputElement).type !== 'range')) return;
    const onRange = tag === 'INPUT';
    const onButton = tag === 'BUTTON';
    switch (e.key) {
      case ' ':
        if (onButton) return; // let the focused button act
        e.preventDefault();
        togglePlay();
        return;
      case 'k':
      case 'K':
        e.preventDefault();
        togglePlay();
        return;
      case 'ArrowLeft':
      case 'j':
      case 'J':
        if (onRange && e.key === 'ArrowLeft') return;
        e.preventDefault();
        step(-1);
        return;
      case 'ArrowRight':
      case 'l':
      case 'L':
        if (onRange && e.key === 'ArrowRight') return;
        e.preventDefault();
        step(1);
        return;
      case 'Home':
        if (onRange) return;
        e.preventDefault();
        setPlaying(false);
        go(0);
        return;
      case 'End':
        if (onRange) return;
        e.preventDefault();
        setPlaying(false);
        go(last);
        return;
      case '-':
      case '_':
        e.preventDefault();
        bumpSpeed(-1);
        return;
      case '+':
      case '=':
        e.preventDefault();
        bumpSpeed(1);
        return;
    }
  };

  const current = n ? steps[index] : undefined;
  const narration = current !== undefined && describe ? describe(current, index) : '';

  return (
    <div
      ref={rootRef}
      role="group"
      aria-roledescription="visualization"
      aria-label={title ?? 'Visualization'}
      tabIndex={0}
      className={[s.frame, className].filter(Boolean).join(' ')}
      style={style}
      onKeyDown={onKeyDown}
    >
      {(title || n > 0) && (
        <div className={s.head}>
          {title && <span className={s.title}>{title}</span>}
          <span className={`${s.counter} mono`}>
            step {n ? index + 1 : 0} / {n}
          </span>
        </div>
      )}

      <div className={s.stage} style={{ minHeight: stageMinHeight }}>
        {current !== undefined ? render(current, index) : (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)' }}>No steps to show.</span>
        )}
      </div>

      {describe && <div className={s.narration}>{narration}</div>}
      {/* Announce the narration only when not auto-advancing. */}
      <span className="sr-only" aria-live="polite">{playing ? '' : narration}</span>

      <div className={s.controls}>
        {/* aria-disabled (not disabled) so focus stays put at either end. */}
        <div className={s.transport}>
          <Button variant="ghost" size="sm" tap icon="skip-back" aria-label="First step" aria-disabled={index === 0} onClick={() => { setPlaying(false); go(0); }} />
          <Button variant="ghost" size="sm" tap icon="chev-left" aria-label="Previous step" aria-disabled={index === 0} onClick={() => step(-1)} />
          <Button
            variant="accent"
            size="sm"
            tap
            icon={playing ? 'pause' : 'play'}
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={togglePlay}
            disabled={n < 2}
          />
          <Button variant="ghost" size="sm" tap icon="chev-right" aria-label="Next step" aria-disabled={index >= last} onClick={() => step(1)} />
          <Button variant="ghost" size="sm" tap icon="skip-forward" aria-label="Last step" aria-disabled={index >= last} onClick={() => { setPlaying(false); go(last); }} />
        </div>
        <input
          type="range"
          className={s.scrub}
          min={0}
          max={last}
          step={1}
          value={index}
          disabled={n < 2}
          aria-label="Step"
          aria-valuetext={`Step ${index + 1} of ${n}${narration ? `: ${narration}` : ''}`}
          onChange={(e) => {
            setPlaying(false);
            go(Number(e.target.value));
          }}
        />
        <Select
          size="sm"
          aria-label="Playback speed"
          value={String(speed)}
          onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
          options={SPEEDS.map((v) => ({ value: String(v), label: `${v}×` }))}
        />
        <div className={s.hints} aria-hidden="true">
          <span><Kbd bare>Space</Kbd> play / pause</span>
          <span><Kbd bare>←</Kbd> <Kbd bare>→</Kbd> step</span>
          <span><Kbd bare>Home</Kbd> <Kbd bare>End</Kbd> jump</span>
          <span><Kbd bare>−</Kbd> <Kbd bare>+</Kbd> speed</span>
        </div>
      </div>
    </div>
  );
}
