import type { CSSProperties } from 'react';

/**
 * Indeterminate activity indicator in the icon stroke style. Decorative by
 * default — pair it with visible text or pass `label`. Under reduced motion
 * the global rule in globals.css stops the rotation (a static arc remains).
 */
export function Spinner({ size = 14, label, style }: { size?: number; label?: string; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      style={{ flex: 'none', animation: 'cm-spin 0.8s linear infinite', ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <circle cx="12" cy="12" r="9" opacity={0.25} />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
