import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Halo, Pop, Ring, r1, sec, vars } from '../parts';

/**
 * Arrays & hashing — "Skip the search — jump to the bucket".
 * A hash machine (a chomping bit) eats a key, shows where it goes — here
 * h(key) = character code mod 8, so K→3, M→5, R→2 — and spits it into that
 * bucket of the array. Later it is asked for M again: same key, same number,
 * and a laser goes straight to bucket 5 without looking at any other bucket.
 * The poster frame (reduced motion) is that last lookup.
 */

const BUCKETS = 8;
const hash = (key: string) => key.charCodeAt(0) % BUCKETS;
const KEYS = ['K', 'M', 'R'];
const TONES = ['p', 'v', 'o'] as const;

const BX0 = 19;
const BPITCH = 35.4;
const BW = 30;
const BY = 134;
const BH = 26;
const TILE = 24;
const bx = (i: number) => BX0 + i * BPITCH;
/** Top-left of a tile resting in bucket i. */
const rest = (i: number) => ({ x: bx(i) + (BW - TILE) / 2, y: BY + 1 });
const MOUTH = { x: 160 - TILE / 2, y: 82 - TILE / 2 };
/** Where keys wait, nearest to the machine first. */
const QUEUE = [{ x: 84, y: 66 }, { x: 54, y: 66 }, { x: 24, y: 66 }];

/** Seconds into the loop (same numbers as the CSS): a key reaches the mouth at T+0.35. */
const T = [0.9, 1.75, 2.6];
const TL = 3.55; // the lookup of M
const SHOW = [T[0] + 0.45, T[1] + 0.45, T[2] + 0.45, TL + 0.45]; // when the machine's answer appears (the last one sits on the At grid: 4.0 s)
const FOUND = 4.4;

const px = (n: number) => `${r1(n)}px`;
const off = (from: { x: number; y: number }, to: { x: number; y: number }) => ({ dx: from.x - to.x, dy: from.y - to.y });

export function ArraysHashingScene() {
  const answers = [...KEYS.map(hash), hash('M')];
  const target = hash('M');
  const tcx = bx(target) + BW / 2;
  const beam = `M160 92L${r1(tcx)} ${BY - 2}`;
  return (
    <>
      <At t={FOUND}>
        <Halo x={tcx} y={BY + BH / 2} r={34} gold />
        <rect className={s.ahPick} x={r1(bx(target) - 3)} y={BY - 3} width={BW + 6} height={BH + 9} rx={9} />
      </At>

      {/* the buckets of the array */}
      <Pop d={0.1}>
        {Array.from({ length: BUCKETS }, (_, i) => (
          <g key={i}>
            <Block x={bx(i)} y={BY} w={BW} h={BH} r={7} tone="s" />
            <text className={s.txm} x={r1(bx(i) + BW / 2)} y={BY + BH + 12} fontSize={7.5}>
              {i}
            </text>
          </g>
        ))}
      </Pop>

      {/* the keys waiting to be hashed */}
      <Pop d={0.05}>
        <rect className={s.fl} x={16} y={66 + TILE + 5} width={96} height={4} rx={2} />
      </Pop>

      {/* the laser: straight from the mouth to the bucket, no scanning */}
      <path className={`${s.ahBeam} ${s.ahBeamWide}`} d={beam} pathLength={1} />
      <path className={s.ahBeam} d={beam} pathLength={1} />

      {/* the machine: a body that chews, two eyes, a mouth, an antenna */}
      <g className={s.ahBody}>
        <Block x={115} y={38} w={90} h={62} r={13} lip={4}>
          <path className={s.ahAnt} d="M45 0V-8" />
          <circle className={s.fg} cx={45} cy={-10} r={3.6} />
          <g className={s.ahEyes}>
            {[25, 65].map((x) => (
              <g key={x}>
                <circle className={s.fw} cx={x} cy={20} r={7} />
                <circle className={s.ahPupil} cx={x - 1.6} cy={21.2} r={3.4} />
              </g>
            ))}
          </g>
          <g className={s.ahMouth}>
            <rect className={s.ahMouthBg} x={21} y={35} width={48} height={17} rx={8.5} />
            {[28, 40, 52].map((x) => (
              <rect key={x} className={s.fw} x={x} y={35} width={9} height={4.5} rx={1.6} />
            ))}
          </g>
        </Block>
      </g>

      {/* what the machine says: the bucket number (the last one, from the lookup, stays up) */}
      <Pop d={0.2}>
        <Block x={212} y={44} w={46} h={24} r={8} tone="g">
          <path className={s.fg} d="M2 12L-7 8V17Z" />
          <text x={13} y={12.5} fontSize={11}>
            #
          </text>
          {answers.map((n, i) =>
            i < 3 ? (
              <text key={i} className={s.show} x={31} y={12.5} fontSize={14} style={{ ...vars({ '--t': sec(SHOW[i]) }), opacity: 0 }}>
                {n}
              </text>
            ) : (
              <At key={i} t={SHOW[i]}>
                <text x={31} y={12.5} fontSize={14}>
                  {n}
                </text>
              </At>
            ),
          )}
        </Block>
      </Pop>

      {/* the keys: wait, get eaten, come out and land in their bucket */}
      {KEYS.map((k, i) => {
        const home = rest(hash(k));
        const q = off(QUEUE[i], home);
        const m = off(MOUTH, home);
        return (
          <g key={k} transform={`translate(${r1(home.x)} ${r1(home.y)})`}>
            <g className={hash(k) === target ? s.pulse : undefined} style={hash(k) === target ? vars({ '--t': sec(FOUND) }) : undefined}>
              <g
                className={s.ahTile}
                style={{
                  animationName: s[`kAhT${i}`],
                  ...vars({ '--qx': px(q.dx), '--qy': px(q.dy), '--mx': px(m.dx), '--my': px(m.dy), '--hx': px(m.dx * 0.5), '--hy': px(m.dy - 14) }),
                }}
              >
                <Block x={0} y={0} w={TILE} h={TILE} r={7} tone={TONES[i]} label={k} size={13} />
              </g>
            </g>
          </g>
        );
      })}

      {/* the lookup: M again, eaten, and the laser does the rest */}
      <g transform={`translate(${QUEUE[0].x} ${QUEUE[0].y})`}>
        <g
          className={s.ahTile}
          style={{ animationName: s.kAhL, opacity: 0, ...vars({ '--qx': '0px', '--qy': '0px', '--mx': px(MOUTH.x - QUEUE[0].x), '--my': px(MOUTH.y - QUEUE[0].y) }) }}
        >
          <Block x={0} y={0} w={TILE} h={TILE} r={7} tone="g" label="M" size={13} />
        </g>
      </g>

      {/* payoff: found in one jump */}
      <Ring x={tcx} y={BY + BH / 2} t={FOUND} r={14} gold w={2.4} />
      <Burst x={tcx} y={BY + 8} t={FOUND} n={9} reach={34} />
      <Coin x={tcx} y={104} t={FOUND + 0.05} r={11} />
    </>
  );
}
