import { describe, expect, it } from 'vitest';
import { IDLE_FLAGS, LOOP_MS, animationsPlay, canRotate, keyToIndex, stepIndex, wrapIndex, type ReelFlags } from './heroReel';

const flags = (over: Partial<ReelFlags>): ReelFlags => ({ ...IDLE_FLAGS, ...over });

describe('canRotate', () => {
  it('rotates when nothing holds it', () => {
    expect(canRotate(IDLE_FLAGS)).toBe(true);
  });

  it.each([
    ['the pause button', { userPaused: true }],
    ['a mouse over the reel', { pointerOver: true }],
    ['keyboard focus inside the reel', { keyboardFocus: true }],
    ['a hidden tab', { pageHidden: true }],
    ['scrolling out of view', { offScreen: true }],
    ['reduced motion', { reducedMotion: true }],
  ] as const)('holds for %s', (_name, over) => {
    expect(canRotate(flags(over))).toBe(false);
  });

  it('holds when several reasons stack, and releases only when all are gone', () => {
    const both = flags({ pointerOver: true, pageHidden: true });
    expect(canRotate(both)).toBe(false);
    expect(canRotate({ ...both, pointerOver: false })).toBe(false);
    expect(canRotate({ ...both, pointerOver: false, pageHidden: false })).toBe(true);
  });
});

describe('animationsPlay', () => {
  it('stops for the pause button, for off-screen and for reduced motion', () => {
    expect(animationsPlay(IDLE_FLAGS)).toBe(true);
    expect(animationsPlay(flags({ userPaused: true }))).toBe(false);
    expect(animationsPlay(flags({ offScreen: true }))).toBe(false);
    expect(animationsPlay(flags({ reducedMotion: true }))).toBe(false);
  });

  it('keeps playing while the learner hovers or tabs through the switcher', () => {
    expect(animationsPlay(flags({ pointerOver: true }))).toBe(true);
    expect(animationsPlay(flags({ keyboardFocus: true }))).toBe(true);
    expect(animationsPlay(flags({ pageHidden: true }))).toBe(true);
  });
});

describe('wrapIndex / stepIndex', () => {
  it('wraps both ways', () => {
    expect(wrapIndex(10, 10)).toBe(0);
    expect(wrapIndex(-1, 10)).toBe(9);
    expect(wrapIndex(23, 10)).toBe(3);
    expect(stepIndex(9, 10)).toBe(0);
    expect(stepIndex(0, 10, -1)).toBe(9);
    expect(stepIndex(4, 10, 1)).toBe(5);
  });

  it('is safe on an empty list', () => {
    expect(wrapIndex(3, 0)).toBe(0);
    expect(stepIndex(0, 0)).toBe(0);
  });
});

describe('keyToIndex', () => {
  it('maps the roving-focus keys of a horizontal toolbar', () => {
    expect(keyToIndex('ArrowRight', 3, 10)).toBe(4);
    expect(keyToIndex('ArrowDown', 3, 10)).toBe(4);
    expect(keyToIndex('ArrowLeft', 3, 10)).toBe(2);
    expect(keyToIndex('ArrowUp', 3, 10)).toBe(2);
    expect(keyToIndex('Home', 6, 10)).toBe(0);
    expect(keyToIndex('End', 6, 10)).toBe(9);
  });

  it('wraps at the ends', () => {
    expect(keyToIndex('ArrowRight', 9, 10)).toBe(0);
    expect(keyToIndex('ArrowLeft', 0, 10)).toBe(9);
  });

  it('ignores every other key so typing and shortcuts still work', () => {
    for (const k of ['Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown']) expect(keyToIndex(k, 2, 10)).toBeNull();
  });
});

describe('LOOP_MS', () => {
  it('is the ~7 s the reel stays on a topic', () => {
    expect(LOOP_MS).toBeGreaterThanOrEqual(4000);
    expect(LOOP_MS).toBeLessThanOrEqual(8000);
  });
});
