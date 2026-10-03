import type { CSSProperties, ReactNode } from 'react';
import s from './Kbd.module.css';

/**
 * Inline keyboard shortcut tag — used inside Button kbd= and Input kbd=, and
 * standalone in prose ("Press <Kbd>⌘K</Kbd>"). Set in `--fs-xs` (12 px), the
 * smallest size anything in the app is set in. Pass `bare` to drop the
 * leading gap it carries for sitting after a label. (The `kbd=` hints on
 * Button and Input hide themselves on touch devices; a Kbd in prose does not,
 * so hide the whole sentence there — see `useTouchOnly`.)
 */
export function Kbd({
  children, bare = false, className, style,
}: { children: ReactNode; bare?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <kbd className={['mono', s.kbd, bare && s.bare, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </kbd>
  );
}
