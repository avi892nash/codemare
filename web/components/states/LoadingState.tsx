import type { CSSProperties } from 'react';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import s from './states.module.css';

export type LoadingVariant = 'list' | 'editor' | 'inline';

interface LoadingStateProps {
  /** list: catalog-style page · editor: statement + code + results · inline: spinner + label. */
  variant?: LoadingVariant;
  /** Announced to screen readers (and shown for `inline`). */
  label?: string;
  /** Rows in the list skeleton. */
  rows?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Loading placeholders shaped like the screen that is coming, so layout does
 * not jump. role="status" + aria-busy with a visually hidden label; the
 * skeletons themselves are aria-hidden. Use from `loading.tsx` files.
 * Server-safe.
 */
export function LoadingState({ variant = 'list', label = 'Loading…', rows = 8, className, style }: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <span role="status" aria-live="polite" className={[s.inline, className].filter(Boolean).join(' ')} style={style}>
        <Spinner size={14} />
        {label}
      </span>
    );
  }
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={[s.status, className].filter(Boolean).join(' ')} style={style}>
      <span className="sr-only">{label}</span>
      {variant === 'editor' ? <EditorSkeleton /> : <ListPageSkeleton rows={rows} />}
    </div>
  );
}

/** Catalog / submissions shaped page: heading, filter chips, table rows. */
export function ListPageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className={s.listPage} aria-hidden="true">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton width={70} height={10} />
        <Skeleton width={220} height={24} radius={6} />
        <Skeleton width="min(360px, 80%)" height={12} />
      </div>
      <div className={s.listFilters}>
        <Skeleton width={220} height={32} radius={6} />
        {[64, 78, 70, 90].map((w, i) => <Skeleton key={i} width={w} height={26} radius={999} />)}
      </div>
      <div className={s.listTable}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={s.listRow}>
            <Skeleton circle height={16} />
            <Skeleton width={`${38 + ((i * 17) % 30)}%`} height={12} />
            <span style={{ flex: 1 }} />
            <span className={s.listTags}>
              <Skeleton width={54} height={18} radius={999} />
              <Skeleton width={44} height={18} radius={999} />
            </span>
            <Skeleton width={52} height={18} radius={999} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Problem editor shaped page: statement column, toolbar, code, results. */
export function EditorSkeleton() {
  return (
    <div className={s.editor} aria-hidden="true">
      <div className={s.editorStatement}>
        <div style={{ display: 'flex', gap: 14 }}>
          {[72, 64, 78].map((w, i) => <Skeleton key={i} width={w} height={12} />)}
        </div>
        <Skeleton width="70%" height={20} radius={6} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Skeleton width={52} height={18} radius={999} />
          <Skeleton width={64} height={18} radius={999} />
        </div>
        <SkeletonText lines={4} />
        <SkeletonText lines={3} lastWidth="40%" />
        <Skeleton height={86} radius={6} />
        <Skeleton height={86} radius={6} />
      </div>
      <div className={s.editorMain}>
        <div className={s.editorToolbar}>
          <Skeleton width={110} height={24} radius={6} />
          <span style={{ flex: 1 }} />
          <Skeleton width={64} height={28} radius={6} />
          <Skeleton width={78} height={28} radius={6} />
        </div>
        <div className={s.editorCode}>
          {[46, 62, 38, 71, 55, 30, 66, 42, 24].map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Skeleton width={14} height={10} />
              <Skeleton width={`${w}%`} height={10} />
            </div>
          ))}
        </div>
        <div className={s.editorResults}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Skeleton width={120} height={18} radius={6} />
            <Skeleton width={60} height={18} radius={999} />
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width={54} height={9} />
                <Skeleton width={70} height={18} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
