import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Placeholder block with the design's slow pulse (static under reduced
 * motion). Decorative: wrap loading regions in <LoadingState> (or give the
 * region role="status" + a visually hidden "Loading…") for screen readers.
 */
export function Skeleton({ width = '100%', height = 12, radius, circle = false, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skel ${className ?? ''}`.trim()}
      style={{
        display: 'block',
        flex: 'none',
        width: circle ? height : width,
        height,
        borderRadius: circle ? 999 : radius ?? 4,
        ...style,
      }}
    />
  );
}

/** Paragraph placeholder: `lines` bars, the last one shorter. */
export function SkeletonText({
  lines = 3, lineHeight = 10, gap = 8, lastWidth = '60%', style,
}: { lines?: number; lineHeight?: number; gap?: number; lastWidth?: string; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </span>
  );
}
