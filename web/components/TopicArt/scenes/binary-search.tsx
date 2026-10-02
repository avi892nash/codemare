import s from '../topicArt.module.css';
import { Block, Burst, Coin, Halo, Pop, Ring, r2, sec, steps, vars } from '../parts';

/**
 * Binary search — "Guess smarter: halve the pile".
 * Fifteen sorted pillars (a staircase) and a gold line at the height we are
 * after (49). The search really runs below (search()) and its trace drives the
 * scene: a spotlight hops to each probe's middle pillar, a chip says which way
 * to go (too short → right, too tall → left), every pillar outside the live
 * range falls away — 15 → 7 → 3 → 1 pillars, and the bars underneath keep the
 * score. The fourth probe touches the line: the pillar widens and lights up,
 * confetti, a +1. The poster frame (reduced motion) is that last moment.
 */

const A = [4, 9, 13, 18, 22, 27, 31, 36, 40, 44, 49, 53, 58, 63, 71];
const TARGET = 49;

interface Probe {
  lo: number;
  hi: number;
  mid: number;
  /** 1: the middle is too small (go right), -1: too big (go left), 0: found. */
  dir: 1 | -1 | 0;
}

/** The real binary search, recording every probe with the live range it started from. */
function search(a: number[], target: number): Probe[] {
  const probes: Probe[] = [];
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const dir = a[mid] === target ? 0 : a[mid] < target ? 1 : -1;
    probes.push({ lo, hi, mid, dir });
    if (dir === 0) break;
    if (dir > 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return probes;
}

const probes = search(A, TARGET);
// The keyframes (kBsP / kBsEg in the CSS) have one state per probe: four of them.
if (probes.length !== 4 || probes[3].dir !== 0) {
  throw new Error('binary-search scene: the CSS steps expect a 4-probe search that ends on the target');
}

/** The live range at stage 0 (everything) and after probes 1..3 (the last one is just the target). */
const stages = [
  { lo: 0, hi: A.length - 1 },
  ...probes.slice(0, 3).map((p) => (p.dir > 0 ? { lo: p.mid + 1, hi: p.hi } : { lo: p.lo, hi: p.mid - 1 })),
];
const FOUND = probes[3].mid;

const W = 17;
const PITCH = 19.5;
const X0 = 15;
const BASE = 138; // where the pillars stand
const height = (a: number) => 4 + a * 1.25;
const top = (i: number) => BASE - height(A[i]);
const cx = (i: number) => X0 + i * PITCH + W / 2;
const left = (i: number) => X0 + i * PITCH;
const LINE_Y = BASE - height(TARGET);

/** Seconds into the loop: probe k starts at P[k]; its verdict (pillars fall) lands 0.45 s later. The CSS has the same numbers. */
const P = [0.95, 2.05, 3.15, 4.25];
const F = 4.95; // payoff

/** 1 when pillar i is outside the live range at stage j. */
const dead = (i: number, j: number) => (i >= stages[j].lo && i <= stages[j].hi ? 0 : 1);

/** The probe that retires pillar i (null for the answer): the fall ripples out from that probe's middle. */
function retiredBy(i: number): Probe | null {
  for (let j = 1; j < 4; j++) if (dead(i, j)) return probes[j - 1];
  return null;
}

export function BinarySearchScene() {
  return (
    <>
      <g className={s.bsHalo}>
        <Halo x={cx(FOUND)} y={top(FOUND) + height(A[FOUND]) / 2} r={34} />
      </g>

      {/* the height we are after */}
      <Pop d={0.2}>
        <line className={s.bsLine} x1={66} x2={312} y1={LINE_Y} y2={LINE_Y} strokeWidth={1.8} strokeDasharray="5 4.5" />
        <g className={s.pulse} style={vars({ '--t': sec(F) })}>
          <Block x={12} y={LINE_Y - 10} w={50} h={20} r={7} tone="g">
            <circle className={s.tgt} cx={13} cy={10} r={4.8} />
            <circle className={s.tgtDot} cx={13} cy={10} r={1.6} />
            <text x={34} y={10.5} fontSize={10.5}>
              {TARGET}
            </text>
          </Block>
        </g>
      </Pop>

      {/* the spotlight on each probe's middle pillar */}
      <Pop d={0.3}>
        <g className={s.bsP} style={steps(5, (j) => ({ x: `${r2(cx(probes[Math.min(3, Math.max(0, j - 1))].mid))}px`, o: j === 5 ? 0 : 1 }), { '--o0': 0, '--sx0': 0.3, '--sy0': 0.3 })}>
          <rect className={s.beam} x={-11} y={41} width={22} height={BASE - 41} rx={4} />
          <path className={s.fah} d="M-5.5 35H5.5L0 44.5Z" />
        </g>
      </Pop>

      {/* the funnel: the live range before each probe, 15 → 7 → 3 → 1 */}
      {probes.map((p, k) => (
        <rect
          key={k}
          className={`${k === 3 ? s.fg : s.fah} ${s.bsBar}`}
          x={r2(left(p.lo))}
          y={149 + k * 7}
          width={r2((p.hi - p.lo + 1) * PITCH - 2.5)}
          height={4.5}
          rx={2.25}
          style={steps(5, (j) => ({ o: j > k ? 1 : 0, sx: j > k ? 1 : 0 }))}
        />
      ))}

      {/* the pillars */}
      {A.map((v, i) => {
        const probe = probes.findIndex((p) => p.mid === i);
        const by = retiredBy(i);
        const h = height(v);
        const pillar = <Block x={left(i)} y={top(i)} w={W} h={h} r={4.5} label={h >= 22 ? v : undefined} size={7.5} ly={8.5} />;
        return (
          <Pop key={i} d={i * 0.035} up>
            <g className={s.bsDead} style={steps(3, (j) => ({ g: dead(i, j) }), { '--rd': sec(by ? Math.abs(i - by.mid) * 0.035 : 0) })}>
              {i === FOUND ? (
                <g className={s.bsFound}>
                  <g className={s.bsPing} style={vars({ '--t': sec(P[3] + 0.28) })}>
                    {pillar}
                    <rect className={s.bsFrame} x={left(i) - 2.2} y={top(i) - 2.2} width={W + 4.4} height={h + 4.4 + 3} rx={6.2} />
                  </g>
                </g>
              ) : probe >= 0 ? (
                <g className={s.bsPing} style={vars({ '--t': sec(P[probe] + 0.28) })}>
                  {pillar}
                </g>
              ) : (
                pillar
              )}
            </g>
          </Pop>
        );
      })}

      {/* a ping where each probe meets the line */}
      {probes.map((p, k) => (
        <Ring key={k} x={cx(p.mid)} y={top(p.mid)} t={P[k] + 0.28} r={11} />
      ))}

      {/* which way to go: → the middle was too short, ← too tall */}
      {probes.slice(0, 3).map((p, k) => (
        <g key={k} transform={`translate(${r2(cx(p.mid))} 25)`}>
          <g className={s.bsCmp} style={vars({ '--t': sec(P[k] + 0.3) })}>
            <rect className={s.fw} x={-9.5} y={-6.5} width={19} height={13} rx={4.5} />
            <path className={s.sk} d={p.dir > 0 ? 'M-4 0H4M1 -3L4.2 0L1 3' : 'M4 0H-4M-1 -3L-4.2 0L-1 3'} strokeWidth={1.9} />
          </g>
        </g>
      ))}

      {/* payoff */}
      <Ring x={cx(FOUND)} y={LINE_Y} t={F} r={14} gold w={2.4} />
      <Ring x={cx(FOUND)} y={LINE_Y} t={F + 0.16} r={21} w={1.6} />
      <Burst x={cx(FOUND)} y={LINE_Y} t={F} n={10} reach={40} />
      <Coin x={cx(FOUND)} y={LINE_Y - 30} t={F + 0.05} r={11} />
    </>
  );
}
