import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Hop, Pop, Ring, r1, sec, steps, vars } from '../parts';

/**
 * Two pointers — "Two pointers, one meet-in-the-middle".
 * A sorted row and a target (20). Two bits stand at the two ends and the pair
 * of numbers under them is summed (the pill): too small → the left bit hops
 * right, too big → the right bit hops left, never looking back. The search
 * really runs below (twoSum()): 2+14, 3+14, 5+14 are short, 8+14 is long, then
 * 8+12 = 20. Blocks the bits have left behind sink out of play. The poster
 * frame (reduced motion) is the moment they meet on the answer.
 */

const A = [2, 3, 5, 8, 9, 12, 14];
const TARGET = 20;

interface Eval {
  l: number;
  r: number;
  sum: number;
  /** 1: too small (left hops right) · -1: too big (right hops left) · 0: found. */
  cmp: 1 | -1 | 0;
}

/** Two-sum on a sorted row, recording every pair the pointers look at. */
function twoSum(a: number[], target: number): Eval[] {
  const evals: Eval[] = [];
  let l = 0;
  let r = a.length - 1;
  while (l < r) {
    const sum = a[l] + a[r];
    const cmp = sum === target ? 0 : sum < target ? 1 : -1;
    evals.push({ l, r, sum, cmp });
    if (cmp === 0) break;
    if (cmp > 0) l++;
    else r--;
  }
  return evals;
}

const evals = twoSum(A, TARGET);
// The keyframes (kTwLx/Ly, kTwRx/Ry, kTwG) are timed for this run: three short sums, one long, one hit.
if (evals.map((e) => e.cmp).join() !== '1,1,1,-1,0') throw new Error('two-pointers scene: the CSS is timed for hops L, L, L, R and then a hit');
const FOUND = evals[evals.length - 1];

const BW = 34;
const PITCH = 40;
const X0 = 23;
const BY = 120;
const BH = 34;
const BIT_W = 32;
const BIT_H = 29;
const left = (i: number) => X0 + i * PITCH;
const cx = (i: number) => left(i) + BW / 2;

/** Seconds: pair k is looked at (the pill shows its sum) at E[k]; the hop it causes starts 0.3 s later. Same as the CSS. */
const E = [1.0, 1.8, 2.6, 3.4, 4.2];

/** 1 when block i is out of play after n hops (to the left of the left bit or to the right of the right bit). */
const outOfPlay = (i: number, n: number) => {
  const e = evals[Math.min(n, evals.length - 1)];
  return i < e.l || i > e.r ? 1 : 0;
};

/** A bit: a chunky body with two eyes and two feet (the feet sit behind the body, in its lip color). */
function Bit({ tone, look }: { tone: 'p' | 'c'; look: 1 | -1 }) {
  return (
    <g data-b={tone}>
      <g>
        <rect x={5} y={BIT_H - 3} width={9} height={6} rx={2.4} />
        <rect x={BIT_W - 14} y={BIT_H - 3} width={9} height={6} rx={2.4} />
      </g>
      <Block x={0} y={0} w={BIT_W} h={BIT_H} r={11} tone={tone}>
        <g className={s.twEyes}>
          {[BIT_W * 0.29, BIT_W * 0.71].map((x) => (
            <g key={x}>
              <circle className={s.fw} cx={r1(x)} cy={r1(BIT_H * 0.44)} r={5.4} />
              <circle className={s.ahPupil} cx={r1(x + look * 1.6)} cy={r1(BIT_H * 0.44 + 1.2)} r={2.6} />
            </g>
          ))}
        </g>
      </Block>
    </g>
  );
}

export function TwoPointersScene() {
  const mid = (cx(FOUND.l) + cx(FOUND.r)) / 2;
  return (
    <>
      {/* the target */}
      <Pop d={0.1}>
        <g className={s.pulse} style={vars({ '--t': sec(E[4]) })}>
          <Block x={23} y={24} w={54} h={22} r={7} tone="g">
            <circle className={s.tgt} cx={13} cy={11} r={4.8} />
            <circle className={s.tgtDot} cx={13} cy={11} r={1.6} />
            <text x={34} y={11.5} fontSize={11}>
              {TARGET}
            </text>
          </Block>
        </g>
      </Pop>

      {/* the sum of the pair the bits stand on, and how it compares: ▲ too small, ▼ too big, ✓ hit */}
      <Pop d={0.2}>
        {evals.map((e, k) => {
          const last = k === evals.length - 1;
          const card = (
            <g key={k} className={last ? undefined : s.show} style={last ? undefined : { ...vars({ '--t': sec(E[k]) }), opacity: 0 }}>
              <Block x={122} y={24} w={76} h={24} r={8} tone={last ? 'g' : 's'}>
                <text x={28} y={12.5} fontSize={14}>
                  {e.sum}
                </text>
                {last ? (
                  <path className={s.sk} d="M53 12.4L57.6 17L66 7.6" strokeWidth={2.6} />
                ) : (
                  <path className={e.cmp > 0 ? s.twUp : s.twDown} d={e.cmp > 0 ? 'M53 16.5L60 7.5L67 16.5Z' : 'M53 7.5L60 16.5L67 7.5Z'} />
                )}
              </Block>
            </g>
          );
          return last ? (
            <At key={k} t={E[k]}>
              {card}
            </At>
          ) : (
            card
          );
        })}
      </Pop>

      {/* the row */}
      {A.map((v, i) => (
        <Pop key={i} d={0.05 + i * 0.05} up>
          <g className={s.twBlock} style={steps(4, (n) => ({ g: outOfPlay(i, n) }))}>
            <Block x={left(i)} y={BY} w={BW} h={BH} r={9} tone="s" label={v} size={13} />
          </g>
        </Pop>
      ))}

      {/* the pair that adds up gets gold frames */}
      <At t={E[4]}>
        {[FOUND.l, FOUND.r].map((i) => (
          <rect key={i} className={s.twPick} x={left(i) - 2.5} y={BY - 2.5} width={BW + 5} height={BH + 8} rx={11} />
        ))}
      </At>

      {/* the bits: each stands on its pointer; the block under it glows in its color */}
      {([
        { i: 0, tone: 'p', look: 1, xs: 'kTwLx', hops: [1.3, 2.1, 2.9], end: FOUND.l },
        { i: A.length - 1, tone: 'c', look: -1, xs: 'kTwRx', hops: [3.7], end: FOUND.r },
      ] as const).map((b) => (
        <Pop key={b.tone} d={0.3}>
          <g transform={`translate(${left(b.i)} 0)`}>
            <g className={s.twX} style={{ animationName: s[b.xs], transform: `translateX(${(b.end - b.i) * PITCH}px)` }}>
              <rect className={b.tone === 'p' ? s.twPadP : s.twPadC} x={0} y={BY} width={BW} height={BH} rx={9} />
              <g transform={`translate(${(BW - BIT_W) / 2} ${BY - BIT_H - 6})`}>
                <Hop at={[...b.hops]} joy={4.3}>
                  <Bit tone={b.tone} look={b.look} />
                </Hop>
              </g>
            </g>
          </g>
        </Pop>
      ))}

      {/* payoff: the pair meets the target */}
      <Ring x={mid} y={BY - 14} t={E[4] + 0.05} r={16} gold w={2.4} />
      <Burst x={mid} y={BY - 14} t={E[4] + 0.05} n={10} reach={42} />
      <Coin x={mid} y={76} t={E[4] + 0.15} r={11} />
    </>
  );
}
