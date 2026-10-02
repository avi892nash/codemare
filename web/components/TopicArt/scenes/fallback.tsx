import s from '../topicArt.module.css';
import { Block, Burst, Coin, Hop, Pop, Ring, r1, steps } from '../parts';

/**
 * Fallback — for any topic slug without a scene of its own (a topic added to
 * the catalog before its art): a bit hops up a four-step staircase and the coin
 * is waiting at the top. Neutral on purpose; it takes whatever hue it is given
 * (the accent for an unknown slug). The poster frame is the bit at the top.
 */

const STEPS = 4;
const SW = 46;
const GAP = 6;
const X0 = (320 - (STEPS * SW + (STEPS - 1) * GAP)) / 2 + 12;
const BASE = 160;
const top = (i: number) => 128 - 24 * i;
const left = (i: number) => X0 + i * (SW + GAP);
const BIT_W = 28;
const BIT_H = 26;
/** Where the bit stands in state n: 0 on the ground left of the stairs, then on step n-1 (relative to the top step). */
const spot = (n: number) => (n === 0 ? { x: 20, y: BASE - BIT_H - 5 } : { x: left(n - 1) + (SW - BIT_W) / 2, y: top(n - 1) - BIT_H - 4 });
const END = spot(STEPS);

export function FallbackScene() {
  return (
    <>
      {Array.from({ length: STEPS }, (_, i) => (
        <Pop key={i} d={0.1 + i * 0.1} up>
          <Block x={left(i)} y={top(i)} w={SW} h={BASE - top(i)} r={8} tone="a" lip={3} />
        </Pop>
      ))}
      <Pop d={0.45}>
        <g transform={`translate(${END.x} ${END.y})`}>
          <g
            className={s.fbBit}
            style={steps(STEPS, (n) => {
              const p = spot(n);
              return { x: `${p.x - END.x}px`, y: `${p.y - END.y}px` };
            })}
          >
            <Hop at={[1.2, 1.9, 2.6, 3.3]} joy={4.2}>
            <g data-b="a" style={{ ['--f' as string]: 'var(--art-white)', ['--l' as string]: 'var(--surf-lo)' }}>
              <g>
                <rect x={5} y={BIT_H - 3} width={9} height={6} rx={2.4} />
                <rect x={BIT_W - 14} y={BIT_H - 3} width={9} height={6} rx={2.4} />
              </g>
              <Block x={0} y={0} w={BIT_W} h={BIT_H} r={10} style={{ ['--f' as string]: 'var(--art-white)', ['--l' as string]: 'var(--surf-lo)', ['--h' as string]: 'var(--art-white)' }}>
                <g className={s.twEyes}>
                  {[BIT_W * 0.3, BIT_W * 0.7].map((x) => (
                    <g key={x}>
                      <circle className={s.fa} cx={r1(x)} cy={r1(BIT_H * 0.44)} r={4.6} />
                      <circle className={s.ahPupil} cx={r1(x + 1.2)} cy={r1(BIT_H * 0.44 + 1)} r={2.2} />
                    </g>
                  ))}
                </g>
              </Block>
            </g>
            </Hop>
          </g>
        </g>
      </Pop>
      <Ring x={END.x + BIT_W / 2} y={END.y + BIT_H / 2} t={4.2} r={16} gold w={2.4} />
      <Burst x={END.x + BIT_W / 2} y={END.y + BIT_H / 2} t={4.2} n={9} reach={36} />
      <Coin x={left(STEPS - 1) + SW / 2 + 38} y={top(STEPS - 1) - 24} t={4.3} r={11} />
    </>
  );
}
