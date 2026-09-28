import { describe, expect, it } from 'vitest';
import { DependencyCycle } from '../errors';
import {
  assertAcyclic,
  dependencyClosure,
  dependencyOrder,
  findCycle,
  graphFromEdges,
  topologicalOrder,
} from './graph';

const g = (o: Record<string, string[]>) => new Map(Object.entries(o));

describe('dependencyClosure', () => {
  it('collects transitive dependencies, excluding the root', () => {
    const graph = g({ a: ['b', 'c'], b: ['d'], c: ['d'], d: [], e: ['a'] });
    expect([...dependencyClosure(graph, 'a')].sort()).toEqual(['b', 'c', 'd']);
    expect([...dependencyClosure(graph, 'd')]).toEqual([]);
    expect([...dependencyClosure(graph, 'e')].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles nodes absent from the map', () => {
    expect([...dependencyClosure(g({ a: ['x'] }), 'a')]).toEqual(['x']);
    expect([...dependencyClosure(g({}), 'nope')]).toEqual([]);
  });

  it('throws DependencyCycle when the root reaches itself', () => {
    expect(() => dependencyClosure(g({ a: ['b'], b: ['c'], c: ['a'] }), 'a')).toThrow(DependencyCycle);
    try {
      dependencyClosure(g({ a: ['b'], b: ['a'] }), 'a');
    } catch (e) {
      expect((e as DependencyCycle).cycle).toEqual(['a', 'b', 'a']);
    }
  });
});

describe('topologicalOrder', () => {
  it('puts dependencies first (diamond)', () => {
    const graph = g({ top: ['left', 'right'], left: ['base'], right: ['base'], base: [] });
    const order = topologicalOrder(graph, ['top', 'left', 'right', 'base']);
    expect(order[0]).toBe('base');
    expect(order[3]).toBe('top');
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('top'));
  });

  it('breaks ties by rank, then id — deterministic', () => {
    const graph = g({ x: [], y: [], z: [] });
    expect(topologicalOrder(graph, ['z', 'y', 'x'])).toEqual(['x', 'y', 'z']);
    const rank = { x: 3, y: 1, z: 2 } as Record<string, number>;
    expect(topologicalOrder(graph, ['x', 'y', 'z'], (id) => rank[id])).toEqual(['y', 'z', 'x']);
  });

  it('only orders the requested subset', () => {
    const graph = g({ a: ['b'], b: ['c'], c: [] });
    expect(topologicalOrder(graph, ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('throws DependencyCycle on a cycle in the subset', () => {
    expect(() => topologicalOrder(g({ a: ['b'], b: ['a'] }), ['a', 'b'])).toThrow(DependencyCycle);
  });
});

describe('dependencyOrder', () => {
  it('is the build order of the prelude: transitive deps, deps first, root excluded', () => {
    const graph = graphFromEdges([
      { from: 'dijkstra', dependsOn: 'heap' },
      { from: 'dijkstra', dependsOn: 'graph' },
      { from: 'heap', dependsOn: 'swap' },
    ]);
    const rank: Record<string, number> = { swap: 0, heap: 1, graph: 2, dijkstra: 3 };
    expect(dependencyOrder(graph, 'dijkstra', (id) => rank[id])).toEqual(['swap', 'heap', 'graph']);
  });
});

describe('findCycle', () => {
  it('returns null for a DAG', () => {
    expect(findCycle(g({ a: ['b', 'c'], b: ['c'], c: [] }))).toBeNull();
    expect(() => assertAcyclic(g({ a: ['b'] }))).not.toThrow();
  });

  it('finds self-loops, 2-cycles and longer cycles as closed paths', () => {
    expect(findCycle(g({ a: ['a'] }))).toEqual(['a', 'a']);
    expect(findCycle(g({ a: ['b'], b: ['a'] }))).toEqual(['a', 'b', 'a']);
    expect(findCycle(g({ root: ['x'], x: ['y'], y: ['z'], z: ['x'] }))).toEqual(['x', 'y', 'z', 'x']);
    expect(() => assertAcyclic(g({ a: ['b'], b: ['a'] }))).toThrow(DependencyCycle);
  });
});
