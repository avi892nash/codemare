'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { isVizId, type VizId } from './ids';
import s from './viz.module.css';

function VizLoading() {
  return (
    <div className={s.placeholder} role="status">
      <Spinner size={14} />
      Loading visualization…
    </div>
  );
}

/*
 * The registry: one `dynamic()` per visualization, each with a literal
 * import() so every visualization is its own chunk. A lesson downloads only
 * the visualizations it actually shows, and none of them ship in the main
 * bundle. Client-only (ssr: false): server-rendering them through
 * next/dynamic shifts React's useId tree (the frame's speed <select>) and
 * breaks hydration; the placeholder keeps the space so nothing jumps.
 */
const REGISTRY: Record<VizId, ComponentType> = {
  'binary-search': dynamic(() => import('./BinarySearchViz'), { ssr: false, loading: VizLoading }),
  'two-pointers': dynamic(() => import('./TwoPointersViz'), { ssr: false, loading: VizLoading }),
  'sliding-window': dynamic(() => import('./SlidingWindowViz'), { ssr: false, loading: VizLoading }),
  'bfs-layers': dynamic(() => import('./BfsLayersViz'), { ssr: false, loading: VizLoading }),
  'dp-table': dynamic(() => import('./DpTableViz'), { ssr: false, loading: VizLoading }),
  'insertion-sort': dynamic(() => import('./InsertionSortViz'), { ssr: false, loading: VizLoading }),
  'hash-map': dynamic(() => import('./HashMapViz'), { ssr: false, loading: VizLoading }),
  'bracket-stack': dynamic(() => import('./BracketStackViz'), { ssr: false, loading: VizLoading }),
  heap: dynamic(() => import('./HeapViz'), { ssr: false, loading: VizLoading }),
};

/** Renders the visualization registered under `id` (`:::viz{id=…}`). */
export function VizMount({ id }: { id: string }) {
  if (!isVizId(id)) {
    return (
      <div className={s.placeholder} role="note">
        <Icon name="alert-circle" size={14} />
        Unknown visualization “{id}”.
      </div>
    );
  }
  const Viz = REGISTRY[id];
  return <Viz />;
}
