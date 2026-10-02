import s from '../topicArt.module.css';
import { At, Burst, Coin, Halo, Pop, Ring, r2, sec, steps, vars } from '../parts';

/**
 * Heaps & greedy — "The best one floats to the top".
 * A max-heap (every parent is at least as big as its children) as a tree.
 * A new number, 95, is dropped in at the next free spot and then sifts up: a
 * gold dot runs to its parent to compare, and while it is bigger the two swap
 * places — 40, then 70, then 90 — until it is at the root. The heap really is
 * built and sifted below (insert()), and the scene checks the heap property
 * before and after. The best is now on top, crowned. The poster frame
 * (reduced motion) is the finished heap.
 */

const HEAP = [90, 70, 80, 40, 50, 30, 60];
const NEW = 95;

const isMaxHeap = (h: number[]) => h.every((v, i) => i === 0 || h[(i - 1) >> 1] >= v);

/** Insert at the end and sift up, recording the heap after the insert and after every swap. */
function insert(heap: number[], value: number): { stages: number[][]; swaps: number } {
  const h = [...heap, value];
  const stages = [[...h]];
  let i = h.length - 1;
  while (i > 0 && h[(i - 1) >> 1] < h[i]) {
    const p = (i - 1) >> 1;
    [h[p], h[i]] = [h[i], h[p]];
    stages.push([...h]);
    i = p;
  }
  return { stages, swaps: stages.length - 1 };
}

const { stages, swaps } = insert(HEAP, NEW);
// The keyframes (kHpS) have the start and three swaps; the heaps must be valid before and after.
if (!isMaxHeap(HEAP) || !isMaxHeap(stages[stages.length - 1]) || swaps !== 3) {
  throw new Error('heaps-greedy scene: the CSS is timed for an insert that sifts up three levels');
}
const FINAL = stages[stages.length - 1];

const LEVEL_Y = [50, 88, 126, 164];
const R = 11.5;
/** Where heap index i sits: row = depth, spread evenly across the width. */
function at(i: number): [number, number] {
  const k = Math.floor(Math.log2(i + 1));
  const j = i - (2 ** k - 1);
  return [r2(20 + ((j + 0.5) * 280) / 2 ** k), LEVEL_Y[k]];
}

const SWAP_AT = [1.8, 2.7, 3.6]; // same as the CSS
const DROP = 1.0; // the new number lands
const CROWN = 4.2; // sifted all the way up

/** Index of a value in a heap stage. */
const idx = (stage: number[], v: number) => stage.indexOf(v);

function Disc({ x, y, tone }: { x: number; y: number; tone: 'a' | 'cool' }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle className={tone === 'cool' ? s.fcl : s.fal} cy={2.8} r={R} />
      <circle className={tone === 'cool' ? s.fc : s.fa} r={R} />
      <circle className={s.fw} cx={-3.6} cy={-3.8} r={2} opacity={0.55} />
    </g>
  );
}

export function HeapsGreedyScene() {
  const edges: Array<[number, number]> = [];
  for (let i = 1; i < FINAL.length; i++) edges.push([(i - 1) >> 1, i]);
  const newIdx = FINAL.length - 1; // the free spot the new number lands in
  const [rx, ry] = at(0);
  // The nodes that change place: the new value and every value it swaps with, with where each sits at each stage.
  const movers = [NEW, ...stages.slice(1).map((_, k) => stages[k][(idx(stages[k], NEW) - 1) >> 1])];
  return (
    <>
      <At t={CROWN}>
        <Halo x={rx} y={ry} r={42} gold />
      </At>

      {/* the edges of the heap (the last one is drawn when the new number is added) */}
      <Pop d={0.1}>
        {edges.slice(0, -1).map(([p, c]) => (
          <path key={c} className={s.hpEdge} d={`M${at(p)[0]} ${at(p)[1]}L${at(c)[0]} ${at(c)[1]}`} />
        ))}
      </Pop>
      <path className={`${s.hpEdge} ${s.hpNew}`} d={`M${at(edges[edges.length - 1][0])[0]} ${at(edges[edges.length - 1][0])[1]}L${at(newIdx)[0]} ${at(newIdx)[1]}`} pathLength={1} style={{ animationName: s.kRcE0 }} />

      {/* the compare: a gold dot runs from the new number to its parent before each swap */}
      {Array.from({ length: swaps }, (_, k) => {
        const from = idx(stages[k], NEW);
        const to = (from - 1) >> 1;
        return <path key={k} className={s.rcPulse} d={`M${at(from)[0]} ${at(from)[1]}L${at(to)[0]} ${at(to)[1]}`} pathLength={1} style={vars({ '--t': sec(SWAP_AT[k] - 0.22) })} />;
      })}

      {/* the numbers that stay put */}
      <Pop d={0.2}>
        {FINAL.map((v, i) => {
          if (movers.includes(v)) return null;
          const [x, y] = at(i);
          return (
            <g key={v}>
              <Disc x={x} y={y} tone="a" />
              <text x={x} y={y + 0.5} fontSize={11}>
                {v}
              </text>
            </g>
          );
        })}
      </Pop>

      {/* the numbers that move: they start where the heap had them and end where it has them now */}
      {movers.map((v) => {
        const fin = at(idx(FINAL, v));
        const isNew = v === NEW;
        const node = (
          <g transform={`translate(${fin[0]} ${fin[1]})`}>
            <g className={s.hpMove} style={steps(swaps, (n) => {
              const [x, y] = at(idx(stages[n], v));
              return { x: `${r2(x - fin[0])}px`, y: `${r2(y - fin[1])}px` };
            })}>
              <Disc x={0} y={0} tone={isNew ? 'cool' : 'a'} />
              <text y={0.5} fontSize={11}>
                {v}
              </text>
            </g>
          </g>
        );
        return isNew ? (
          <At key={v} t={DROP} up>
            {node}
          </At>
        ) : (
          <Pop key={v} d={0.2}>
            {node}
          </Pop>
        );
      })}

      {/* the best, crowned */}
      <At t={CROWN} up>
        <g transform={`translate(${rx} ${ry - R - 1})`}>
          <path className={s.hpCrown} d="M-9 0L-10.5 -11L-4.5 -6L0 -13L4.5 -6L10.5 -11L9 0Z" />
          <rect className={s.hpCrown} x={-9.5} y={0} width={19} height={3.4} rx={1.7} />
        </g>
      </At>
      <Ring x={rx} y={ry} t={CROWN} r={15} gold w={2.4} />
      <Burst x={rx} y={ry} t={CROWN} n={10} reach={42} />
      <Coin x={rx + 50} y={ry - 4} t={CROWN + 0.05} r={11} />
    </>
  );
}
