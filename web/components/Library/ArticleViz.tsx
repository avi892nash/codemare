'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { isVizId, type VizId } from './viz/ids';
import s from './library.module.css';

function VizLoading() {
  return (
    <div className={s.vizFallback} role="status" aria-busy="true">
      <span className="sr-only">Loading visualization…</span>
      <Skeleton height={14} width="40%" />
      <Skeleton height={150} />
      <Skeleton height={28} />
    </div>
  );
}

const lazy = (load: () => Promise<{ default: ComponentType }>) => dynamic(load, { ssr: false, loading: VizLoading });

/**
 * Every visualization is its own dynamically imported chunk, fetched only
 * when an article that uses it is on screen — none of this code lands in a
 * shared bundle.
 */
const REGISTRY: Record<VizId, ComponentType> = {
  sieve: lazy(() => import('./viz/SieveViz')),
  'binary-exponentiation': lazy(() => import('./viz/BinaryExponentiationViz')),
  fenwick: lazy(() => import('./viz/FenwickViz')),
  dsu: lazy(() => import('./viz/DsuViz')),
  dijkstra: lazy(() => import('./viz/DijkstraViz')),
  'topological-sort': lazy(() => import('./viz/TopoSortViz')),
  'prefix-function': lazy(() => import('./viz/PrefixFunctionViz')),
  'z-function': lazy(() => import('./viz/ZFunctionViz')),
};

export function ArticleViz({ id }: { id: string }) {
  if (!isVizId(id)) return null;
  const Viz = REGISTRY[id];
  return <Viz />;
}
