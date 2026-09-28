'use client';

import { usePathname } from 'next/navigation';
import { CatalogSkeleton } from '@/components/Catalog/CatalogSkeleton';
import { LoadingState } from '@/components/states/LoadingState';

/**
 * Loading state for /problems. This boundary also covers /problems/[slug]
 * until that segment ships its own loading.tsx, so it picks the skeleton by
 * path: catalog rows here, the editor layout for a problem.
 */
export default function ProblemsLoading() {
  const pathname = usePathname();
  if (pathname !== '/problems') return <LoadingState variant="editor" label="Loading problem…" />;
  return (
    <div role="status" aria-live="polite" aria-busy="true" style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <span className="sr-only">Loading problems…</span>
      <CatalogSkeleton />
    </div>
  );
}
