/**
 * Pure component dependency-graph logic (spec §2 component_deps, §4
 * prelude): cycle detection, transitive closure, topological order.
 *
 * A graph maps a node to the nodes it depends on. Order is always
 * dependencies-first, which is the order a prelude is concatenated in.
 */
import { DependencyCycle } from '../errors';

export type DepGraph = ReadonlyMap<string, readonly string[]>;

/** Build a graph from edge rows. Nodes without edges may be listed in `nodes`. */
export function graphFromEdges(
  edges: Iterable<{ from: string; dependsOn: string }>,
  nodes: Iterable<string> = []
): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const n of nodes) if (!g.has(n)) g.set(n, []);
  for (const e of edges) {
    if (!g.has(e.from)) g.set(e.from, []);
    if (!g.has(e.dependsOn)) g.set(e.dependsOn, []);
    g.get(e.from)!.push(e.dependsOn);
  }
  return g;
}

/**
 * First cycle found, as a closed path `[a, b, …, a]` (a depends on b …),
 * or null when the graph is acyclic. Deterministic for a given graph.
 */
export function findCycle(graph: DepGraph): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const nodes = new Set<string>(graph.keys());
  for (const deps of graph.values()) deps.forEach((d) => nodes.add(d));

  for (const start of [...nodes].sort()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    // Iterative DFS keeping the current path for cycle reconstruction.
    const path: string[] = [];
    const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];
    color.set(start, GRAY);
    path.push(start);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const deps = graph.get(top.node) ?? [];
      if (top.next < deps.length) {
        const dep = deps[top.next++];
        const c = color.get(dep) ?? WHITE;
        if (c === GRAY) return [...path.slice(path.indexOf(dep)), dep];
        if (c === WHITE) {
          color.set(dep, GRAY);
          path.push(dep);
          stack.push({ node: dep, next: 0 });
        }
      } else {
        color.set(top.node, BLACK);
        path.pop();
        stack.pop();
      }
    }
  }
  return null;
}

/** Throws DependencyCycle when the graph has a cycle. */
export function assertAcyclic(graph: DepGraph): void {
  const cycle = findCycle(graph);
  if (cycle) throw new DependencyCycle(cycle);
}

/** Every node `root` transitively depends on (excluding `root`), unordered. */
export function dependencyClosure(graph: DepGraph, root: string): Set<string> {
  const seen = new Set<string>();
  const stack = [...(graph.get(root) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(graph.get(n) ?? []));
  }
  if (seen.has(root)) {
    // root reaches itself: report the actual cycle within the reachable part.
    const sub = new Map([...seen].map((id) => [id, graph.get(id) ?? []]));
    throw new DependencyCycle(findCycle(sub) ?? [root, root]);
  }
  return seen;
}

/**
 * Topologically order `ids` (restricted to that set), dependencies first.
 * Ties break by `rank` (ascending), then id — so the result is stable.
 * Throws DependencyCycle if the subgraph has a cycle.
 */
export function topologicalOrder(
  graph: DepGraph,
  ids: Iterable<string>,
  rank: (id: string) => number = () => 0
): string[] {
  const set = new Set(ids);
  const indegree = new Map<string, number>(); // number of unresolved deps within the set
  const dependents = new Map<string, string[]>();
  for (const id of set) {
    const deps = (graph.get(id) ?? []).filter((d) => set.has(d));
    indegree.set(id, new Set(deps).size);
    for (const d of new Set(deps)) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d)!.push(id);
    }
  }
  const cmp = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const ready = [...set].filter((id) => indegree.get(id) === 0).sort(cmp);
  const out: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    out.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const n = indegree.get(dep)! - 1;
      indegree.set(dep, n);
      if (n === 0) {
        ready.push(dep);
        ready.sort(cmp);
      }
    }
  }
  if (out.length !== set.size) {
    const sub = new Map([...set].map((id) => [id, (graph.get(id) ?? []).filter((d) => set.has(d))]));
    throw new DependencyCycle(findCycle(sub) ?? [...set].filter((id) => !out.includes(id)));
  }
  return out;
}

/** `root`'s transitive dependencies in build order (dependencies first), excluding `root`. */
export function dependencyOrder(
  graph: DepGraph,
  root: string,
  rank?: (id: string) => number
): string[] {
  return topologicalOrder(graph, dependencyClosure(graph, root), rank);
}
