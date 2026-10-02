import s from '../topicArt.module.css';
import { At, Burst, Coin, Pop, Ring } from '../parts';

/**
 * Graphs — "Spread like a rumor (BFS)".
 * A small network; the rumor starts at the gold node and a wave spreads
 * through it level by level. The breadth-first search really runs below
 * (bfs()): every node's label is its distance from the start, every lit edge
 * is the edge that discovered it, and the queue order decides who found whom —
 * so the wave reaches all nodes at distance 1, then all at 2, and so on, and
 * the finish is the shortest path (gold) back from the far node. The poster
 * frame (reduced motion) is that finished picture.
 */

const NODES: Record<string, [number, number]> = {
  S: [40, 96],
  A: [92, 54],
  B: [96, 100],
  C: [92, 146],
  D: [150, 34],
  E: [156, 78],
  F: [152, 122],
  G: [150, 162],
  H: [212, 52],
  I: [214, 100],
  J: [210, 148],
  T: [272, 96],
};
// Undirected edges, listed in the order a node's neighbours are visited.
const EDGES: Array<[string, string]> = [
  ['S', 'A'], ['S', 'B'], ['S', 'C'],
  ['A', 'D'], ['A', 'E'], ['B', 'E'], ['B', 'F'], ['C', 'F'], ['C', 'G'],
  ['D', 'H'], ['E', 'H'], ['E', 'I'], ['F', 'I'], ['F', 'J'], ['G', 'J'],
  ['I', 'T'],
];
const START = 'S';
const GOAL = 'T';

/** Breadth-first search: distance of every node, who discovered it, and the visiting order. */
function bfs(start: string) {
  const adj: Record<string, string[]> = {};
  for (const [a, b] of EDGES) {
    (adj[a] ||= []).push(b);
    (adj[b] ||= []).push(a);
  }
  const dist: Record<string, number> = { [start]: 0 };
  const parent: Record<string, string> = {};
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    for (const n of adj[order[i]]) {
      if (n in dist) continue;
      dist[n] = dist[order[i]] + 1;
      parent[n] = order[i];
      order.push(n);
    }
  }
  return { dist, parent, order };
}

const { dist, parent } = bfs(START);
const LEVELS = Math.max(...Object.values(dist));
// The CSS (kGrWave, kDr0..7) and the At grid below are timed for four levels beyond the start.
if (LEVELS !== 4 || dist[GOAL] !== 4) throw new Error('graphs scene: the CSS is timed for a 4-level wave that ends at the goal');

/** The shortest path back from the goal: [S, …, T]. */
const PATH: string[] = [GOAL];
while (PATH[0] !== START) PATH.unshift(parent[PATH[0]]);

/** Seconds: the nodes of level L light up at LIT[L]; the edges that found them draw 0.4 s earlier. */
const LIT = [0.8, 1.4, 2.2, 3.0, 3.8];
const GOLD = [4.2, 4.4, 4.6, 4.8]; // the shortest path lights up node by node
const [sx, sy] = NODES[START];

const edgeLine = (a: string, b: string) => `M${NODES[a][0]} ${NODES[a][1]}L${NODES[b][0]} ${NODES[b][1]}`;
const treeEdges = Object.entries(parent); // [child, parent]
const NODE_R = 9.5;

function Disc({ x, y, tone }: { x: number; y: number; tone: 'dim' | 'lit' | 'gold' }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className={tone === 'dim' ? s.gDimLip : tone === 'gold' ? s.gGoldLip : s.fal} cy={2.6} r={NODE_R} />
      <circle className={tone === 'dim' ? s.gDim : tone === 'gold' ? s.fg : s.fa} r={NODE_R} />
      {tone !== 'dim' && <circle className={s.fw} cx={-3.3} cy={-3.5} r={1.9} opacity={0.55} />}
    </g>
  );
}

export function GraphsScene() {
  return (
    <>
      {/* the wave: a disc and its edge expanding from the start, reaching each ring of nodes as it lights */}
      <g transform={`translate(${sx} ${sy})`}>
        <g className={s.grWave}>
          <circle className={s.grWaveDisc} r={232} />
          <circle className={s.grWaveRing} r={232} />
        </g>
      </g>

      {/* the network: every edge and node, dim */}
      <Pop d={0.1}>
        {EDGES.map(([a, b]) => (
          <path key={a + b} className={s.grEdge} d={edgeLine(a, b)} />
        ))}
        {Object.entries(NODES).map(([id, [x, y]]) => (
          <Disc key={id} x={x} y={y} tone="dim" />
        ))}
      </Pop>

      {/* the edges that discovered each node, drawn level by level */}
      {treeEdges.map(([child, par]) => (
        <path key={child} className={`${s.grEdge} ${s.grLit}`} d={edgeLine(par, child)} pathLength={1} style={{ animationName: s[`kDr${dist[child] - 1}`] }} />
      ))}
      {/* the shortest path, edge by edge */}
      {PATH.slice(1).map((n, i) => (
        <path key={n} className={`${s.grEdge} ${s.grPath}`} d={edgeLine(PATH[i], n)} pathLength={1} style={{ animationName: s[`kDr${4 + i}`] }} />
      ))}

      {/* the nodes, lit when the wave reaches them; the label is the BFS distance */}
      {Object.entries(NODES).map(([id, [x, y]]) => (
        <At key={id} t={LIT[dist[id]]} style={id === START ? { animationName: s.kAt0 } : undefined}>
          <Disc x={x} y={y} tone={id === START ? 'gold' : 'lit'} />
          <text className={id === START ? s.txd : undefined} x={x} y={y + 0.4} fontSize={9}>
            {dist[id]}
          </text>
        </At>
      ))}

      {/* the path's nodes get a gold ring as it completes */}
      {PATH.slice(1).map((n, i) => (
        <At key={n} t={GOLD[i]}>
          <circle className={s.grRing} cx={NODES[n][0]} cy={NODES[n][1]} r={NODE_R + 4.5} />
        </At>
      ))}

      {/* payoff: the goal is reached by the shortest route */}
      <Ring x={NODES[GOAL][0]} y={NODES[GOAL][1]} t={GOLD[3]} r={14} gold w={2.4} />
      <Burst x={NODES[GOAL][0]} y={NODES[GOAL][1]} t={GOLD[3]} n={9} reach={34} />
      <Coin x={NODES[GOAL][0]} y={NODES[GOAL][1] - 36} t={GOLD[3] + 0.05} r={11} />
      <Ring x={sx} y={sy} t={0.75} r={12} gold w={2.2} />
    </>
  );
}
