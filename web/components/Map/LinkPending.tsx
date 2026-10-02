'use client';

import { useLinkStatus } from 'next/link';
import type { ReactNode } from 'react';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Inside a <Link>: shows a spinner in place of `children` while that link's
 * navigation is in flight. The editor route has no loading.tsx (its
 * skeleton delayed the first real paint by React's 300 ms reveal
 * throttle), so the clicked problem on the map is where the wait shows.
 */
export function LinkPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size={14} label="Opening" /> : <>{children}</>;
}
