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
 * bundle. They still render on the server (first frame visible without JS).
 */
const REGISTRY: Record<VizId, ComponentType> = {
  'binary-search': dynamic(() => import('./BinarySearchViz'), { loading: VizLoading }),
  'two-pointers': dynamic(() => import('./TwoPointersViz'), { loading: VizLoading }),
  'sliding-window': dynamic(() => import('./SlidingWindowViz'), { loading: VizLoading }),
  'bfs-layers': dynamic(() => import('./BfsLayersViz'), { loading: VizLoading }),
  'dp-table': dynamic(() => import('./DpTableViz'), { loading: VizLoading }),
  'insertion-sort': dynamic(() => import('./InsertionSortViz'), { loading: VizLoading }),
  'hash-map': dynamic(() => import('./HashMapViz'), { loading: VizLoading }),
  'bracket-stack': dynamic(() => import('./BracketStackViz'), { loading: VizLoading }),
  heap: dynamic(() => import('./HeapViz'), { loading: VizLoading }),
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
