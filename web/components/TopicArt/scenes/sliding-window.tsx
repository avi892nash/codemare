import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Pop, Ring, sec, steps, vars } from '../parts';

/**
 * Sliding window — "Slide it, don't restart it".
 * A row of numbers and a window three wide that slides along it: each step the
 * number on the right comes in (+) and the number on the left drops out (−),
 * and the running sum is updated from just those two instead of adding the
 * three again. The sums below come from really sliding (windows()), so the
 * chips always agree with the row: 8, 6, 10, 15, 16 and finally 17, the best
 * window (the digits are π's, 3.1415926). The poster frame (reduced motion) is
 * the last window, gold.
 */

const A = [3, 1, 4, 1, 5, 9, 2, 6];
const K = 3;

interface Win {
  /** Index of the window's left end. */
  p: number;
  sum: number;
  /** The number that came in on the right and the one that dropped out on the left (none for the first window). */
  add?: number;
  drop?: number;
  /** The best sum so far. */
  best: number;
}

/** Slide a window of K over the row, updating the sum with one add and one drop per step. */
function windows(a: number[], k: number): Win[] {
  const out: Win[] = [];
  let sum = a.slice(0, k).reduce((x, y) => x + y, 0);
  let best = sum;
  out.push({ p: 0, sum, best });
  for (let p = 1; p + k <= a.length; p++) {
    const add = a[p + k - 1];
    const drop = a[p - 1];
    sum += add - drop;
    best = Math.max(best, sum);
    out.push({ p, sum, add, drop, best });
  }
  return out;
}

const wins = windows(A, K);
// The keyframes (kSwF, kSwL) have one state per window: six, the last one the best.
if (wins.length !== 6 || wins[5].sum !== wins[5].best) throw new Error('sliding-window scene: the CSS is timed for six windows that end on the best one');
const LAST = wins[wins.length - 1];

const BW = 30;
const PITCH = 36;
const X0 = 19;
const BY = 120;
const BH = 30;
const left = (i: number) => X0 + i * PITCH;
const FRAME_W = (K - 1) * PITCH + BW + 14;
/** Seconds into the loop: window n is in place (and its sum shown) at E[n]; the slide into it takes 0.35 s. Same as the CSS. */
const E = [1.0, 1.65, 2.3, 2.95, 3.6, 4.25];

/** 1 when block i is inside window n. */
const inside = (i: number, n: number) => (i >= wins[n].p && i < wins[n].p + K ? 1 : 0);

export function SlidingWindowScene() {
  const fx = (n: number) => left(wins[n].p) - 7; // frame's left edge for window n
  const centre = fx(LAST.p) + FRAME_W / 2;
  return (
    <>
      {/* the best sum so far */}
      <Pop d={0.1}>
        <g className={s.pulse} style={vars({ '--t': sec(E[5]) })}>
          <Block x={19} y={26} w={60} h={24} r={8} tone="g">
            <path className={s.swStar} d="M13 5.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" />
            {[...new Set(wins.map((w) => w.best))].map((best) => (
              <text key={best} className={s.swNum} x={42} y={12.5} fontSize={13} style={steps(5, (n) => ({ o: wins[n].best === best ? 1 : 0 }))}>
                {best}
              </text>
            ))}
          </Block>
        </g>
      </Pop>

      {/* the row */}
      {A.map((v, i) => (
        <Pop key={i} d={0.05 + i * 0.05} up>
          <g className={s.swBlock} style={steps(5, (n) => ({ l: inside(i, n) }))}>
            <Block x={left(i)} y={BY} w={BW} h={BH} r={8} label={v} size={14} />
          </g>
        </Pop>
      ))}

      {/* the window and its running sum */}
      <Pop d={0.35}>
        <g className={s.swFrame} style={{ transform: `translateX(${(LAST.p - wins[0].p) * PITCH}px)` }}>
          <g transform={`translate(${fx(0)} 0)`}>
            <rect className={s.swGlow} x={-6} y={BY - 14} width={FRAME_W + 12} height={BH + 34} rx={16} />
            <rect className={s.swBox} x={0} y={BY - 8} width={FRAME_W} height={BH + 22} rx={12} />
            <At t={4.2}>
              <rect className={s.swGold} x={0} y={BY - 8} width={FRAME_W} height={BH + 22} rx={12} />
            </At>
            {/* the sum, riding on the frame */}
            <Block x={FRAME_W / 2 - 24} y={BY - 42} w={48} h={22} r={8} tone="s" />
            <At t={4.2}>
              <Block x={FRAME_W / 2 - 24} y={BY - 42} w={48} h={22} r={8} tone="g" />
            </At>
            {wins.map((w, n) => (
              <text key={n} className={`${n === wins.length - 1 ? s.txd : s.txl} ${s.swNum}`} x={FRAME_W / 2} y={BY - 30.5} fontSize={13} style={steps(5, (m) => ({ o: m === n ? 1 : 0 }))}>
                {w.sum}
              </text>
            ))}
          </g>
        </g>
      </Pop>

      {/* what comes in on the right and what drops out on the left, each slide */}
      {wins.slice(1).map((w, k) => (
        <g key={k}>
          <g className={s.swChip} style={vars({ '--t': sec(E[k + 1] - 0.3) })}>
            <Block x={left(w.p + K - 1) + 3} y={100} w={24} h={16} r={6} tone="k" lip={2} label={`+${w.add}`} size={9} />
          </g>
          <g className={s.swChip} style={vars({ '--t': sec(E[k + 1] - 0.3) })}>
            <Block x={left(w.p - 1) + 3} y={100} w={24} h={16} r={6} tone="h" lip={2} label={`−${w.drop}`} size={9} />
          </g>
        </g>
      ))}

      {/* payoff: the best window */}
      <Ring x={centre} y={BY + BH / 2} t={E[5]} r={30} gold w={2.4} />
      <Burst x={centre} y={BY + BH / 2 - 6} t={E[5]} n={10} reach={44} />
      <Coin x={centre} y={64} t={E[5] + 0.1} r={11} />
    </>
  );
}
