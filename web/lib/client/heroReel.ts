/**
 * Rules of the sign-in hero reel (components/TopicArt/HeroReel.tsx), kept pure
 * so they can be unit-tested without a DOM.
 *
 * The reel shows one topic scene at a time and moves to the next on its own
 * after one loop of the scene. The "timer" is a CSS animation on the active
 * switcher pip, so pausing it is just `animation-play-state: paused` — these
 * rules only decide *when* it may run and *where* a key or a finished timer
 * takes the reel.
 */

/** One loop of every topic scene, in ms. The reel stays on a topic for one loop. */
export const LOOP_MS = 7000;

/** Everything that can stop the reel from advancing (or the art from playing). */
export interface ReelFlags {
  /** The learner pressed the pause button. Stops the rotation AND the scene's animations (WCAG 2.2.2). */
  userPaused: boolean;
  /** A mouse is over the reel: the learner is looking at it, do not swap the scene away. */
  pointerOver: boolean;
  /** Keyboard focus is inside the reel (keyboard-only: a mouse click on a pip does not count). */
  keyboardFocus: boolean;
  /** The tab is in the background. */
  pageHidden: boolean;
  /** The reel has scrolled out of view (a phone banner above the form): nobody is watching it. */
  offScreen: boolean;
  /** prefers-reduced-motion: the reel never auto-rotates and the art is a still poster frame. */
  reducedMotion: boolean;
}

export const IDLE_FLAGS: ReelFlags = {
  userPaused: false,
  pointerOver: false,
  keyboardFocus: false,
  pageHidden: false,
  offScreen: false,
  reducedMotion: false,
};

/** May the reel move to the next topic on its own right now? */
export function canRotate(f: ReelFlags): boolean {
  return !f.userPaused && !f.pointerOver && !f.keyboardFocus && !f.pageHidden && !f.offScreen && !f.reducedMotion;
}

/**
 * Do the scene animations play? The pause button stops them (WCAG 2.2.2) and
 * so does scrolling the reel out of view (saves a phone's battery). Hover and
 * focus only hold the rotation — the learner is watching the loop — a hidden
 * tab is throttled by the browser anyway, and reduced motion swaps the
 * animation for a poster frame in CSS.
 */
export function animationsPlay(f: ReelFlags): boolean {
  return !f.userPaused && !f.offScreen && !f.reducedMotion;
}

/** `i` wrapped into [0, n). */
export function wrapIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return ((Math.trunc(i) % n) + n) % n;
}

/** The index after (dir 1) or before (dir -1) `i`, wrapping around. */
export function stepIndex(i: number, n: number, dir: 1 | -1 = 1): number {
  return wrapIndex(i + dir, n);
}

/**
 * Where a key takes the topic switcher (a roving-focus toolbar): arrows
 * step (wrapping), Home/End jump to the ends. Null when the key is not for
 * the switcher, so the caller leaves it alone.
 */
export function keyToIndex(key: string, i: number, n: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return stepIndex(i, n, 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return stepIndex(i, n, -1);
    case 'Home':
      return 0;
    case 'End':
      return Math.max(0, n - 1);
    default:
      return null;
  }
}
