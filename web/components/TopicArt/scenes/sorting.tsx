import s from '../topicArt.module.css';
import { Block, Burst, Coin, Pop, Ring, r2, sec, steps, vars } from '../parts';

/**
 * Sorting — "From chaos to order".
 * Six cards, shaded from dark to bright by value, are put in order by
 * insertion sort. The sort really runs below (insertionSort()): each card in
 * turn is lifted out, the bigger ones in front of it slide right one slot at a
 * time, and it drops into the gap — and a bar underneath shows how much of the
 * row is already sorted. A card that is already in place (5, then 6) just
 * joins the sorted part. When it is done the cards form a smooth ramp and hop
 * in a wave. The poster frame (reduced motion) is the sorted row.
 */

const VALUES = [3, 1, 5, 2, 6, 4];

interface Moment {
  /** slot of every card (by id) after this moment */
  pos: number[];
  /** the card lifted out of the row, if any */
  lift: number | null;
  /** how much of the row is sorted */
  prefix: number;
}

/** Insertion sort on card ids, recording a moment for every lift, shift and drop (and how much is sorted). */
function insertionSort(values: number[]): Moment[] {
  const order = values.map((_, id) => id); // order[slot] = card id
  const slotOf = () => {
    const pos: number[] = [];
    order.forEach((id, slot) => (pos[id] = slot));
    return pos;
  };
  const moments: Moment[] = [];
  let prefix = 1;
  for (let i = 1; i < values.length; i++) {
    const key = order[i];
    let j = i - 1;
    if (values[order[j]] <= values[key]) {
      prefix = i + 1; // already in place: joins the sorted part without moving
      continue;
    }
    moments.push({ pos: slotOf(), lift: key, prefix });
    while (j >= 0 && values[order[j]] > values[key]) {
      order[j + 1] = order[j];
      order[j] = key; // the key moves left over the card that stepped right
      moments.push({ pos: slotOf(), lift: key, prefix });
      j--;
    }
    prefix = i + 1;
    moments.push({ pos: slotOf(), lift: null, prefix });
  }
  // cards that were already in place at the end join the prefix too
  moments[moments.length - 1].prefix = values.length;
  return moments;
}

const moments = insertionSort(VALUES);
// The keyframes (kSoX, kSoP in the CSS) have one state per moment: eleven.
if (moments.length !== 11) throw new Error('sorting scene: the CSS is timed for 11 moments');
const first = VALUES.map((_, id) => id); // card id i starts in slot i

const CW = 38;
const CH = 56;
const PITCH = 46;
const X0 = (320 - ((VALUES.length - 1) * PITCH + CW)) / 2;
const Y = 96;
const T0 = 0.9;
const DT = 0.3;
const DONE = T0 + DT * (moments.length - 1) + 0.26; // the last card has dropped
const WAVE = DONE + 0.05;

/** A dark-to-bright ramp through the topic hue, by value. */
function shade(v: number) {
  const t = (v - 1) / (Math.max(...VALUES) - 1);
  const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${r2(100 - p * 100)}%, ${b})`;
  const at = (lo: string, mid: string, hi: string) => (t < 0.5 ? mix(lo, mid, t * 2) : mix(mid, hi, (t - 0.5) * 2));
  return {
    ['--f' as string]: at('var(--a-lo)', 'var(--a)', 'var(--a-hi)'),
    ['--l' as string]: `color-mix(in oklab, ${at('var(--a-lo)', 'var(--a)', 'var(--a-hi)')} 60%, var(--art-black))`,
    ['--h' as string]: `color-mix(in oklab, ${at('var(--a-lo)', 'var(--a)', 'var(--a-hi)')} 50%, var(--art-white))`,
  };
}

export function SortingScene() {
  return (
    <>
      {/* the sorted part grows under the row */}
      <Pop d={0.1}>
        <rect className={s.soRail} x={X0} y={Y + CH + 12} width={(VALUES.length - 1) * PITCH + CW} height={5} rx={2.5} />
      </Pop>
      <rect
        className={s.soDone}
        x={X0}
        y={Y + CH + 12}
        width={(VALUES.length - 1) * PITCH + CW}
        height={5}
        rx={2.5}
        style={steps(moments.length, (n) => ({ p: n === 0 ? 1 : moments[n - 1].prefix }))}
      />

      {VALUES.map((v, id) => (
        <Pop key={id} d={0.05 + id * 0.06} up>
          <g
            className={s.soCard}
            style={steps(moments.length, (n) => {
              const pos = n === 0 ? first : moments[n - 1].pos;
              const lift = n === 0 ? null : moments[n - 1].lift;
              const o: Record<string, number> = {};
              if (pos[id] !== id) o.s = pos[id] - id;
              if (lift === id) o.u = 1;
              return o;
            })}
          >
            <g className={s.soHop} style={vars({ '--t': sec(WAVE + id * 0.07) })}>
              <Block x={X0 + id * PITCH} y={Y} w={CW} h={CH} r={9} label={v} size={20} ly={19} style={shade(v)} outline />
            </g>
          </g>
        </Pop>
      ))}

      {/* payoff: in order */}
      <Ring x={160} y={Y + CH / 2} t={DONE} r={40} gold w={2.2} />
      <Burst x={160} y={Y + 4} t={DONE + 0.05} n={12} reach={60} />
      <Coin x={160} y={56} t={DONE + 0.1} r={12} />
    </>
  );
}
