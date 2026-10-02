import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Pop, Ring, r2, steps } from '../parts';

/**
 * Stack — "Last in, first out".
 * Matching brackets: the input { [ ( ) ] } waits on a tray; each opener drops
 * into the tube (push) and each closer drops onto the top of the pile — the
 * newest opener — and the two annihilate (pop). The tube is filled and emptied
 * by simulating a real stack below, so the match order is the LIFO order:
 * ( first, then [, then {. A gold pointer follows the top of the stack and the
 * matched pairs line up on the left in the order they closed. The poster frame
 * (reduced motion) is three pushed and three waiting.
 */

const INPUT = ['{', '[', '(', ')', ']', '}'];
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const TONE = { '{': 'a', '}': 'a', '[': 'p', ']': 'p', '(': 'c', ')': 'c' } as const;

/** Run the stack: the slot every token ends up in (a closer lands in its opener's slot) and the stack's size after each token. */
function simulate(input: string[]): { slot: number[]; match: Array<number | null>; size: number[] } {
  const stack: number[] = [];
  const slot: number[] = [];
  const match: Array<number | null> = [];
  const size: number[] = [];
  input.forEach((ch, i) => {
    if (OPENER[ch]) {
      const top = stack.pop();
      if (top === undefined || input[top] !== OPENER[ch]) throw new Error('stack scene: the input must be balanced');
      slot[i] = slot[top];
      match[i] = top;
    } else {
      slot[i] = stack.length;
      match[i] = null;
      stack.push(i);
    }
    size[i] = stack.length;
  });
  return { slot, match, size };
}

const { slot, match, size } = simulate(INPUT);
// The keyframes (kStk0..5, kStkTop in the CSS) are timed for exactly this order of pushes and pops.
if (slot.join() !== '0,1,2,2,1,0' || match.join() !== ',,,2,1,0' || size.join() !== '1,2,3,2,1,0') {
  throw new Error('stack scene: the CSS is timed for { [ ( ) ] }');
}

const TOKEN = 26;
const PITCH = 34;
const HOME_X = 62; // first token of the input
const HOME_Y = 26;
const TUBE_X = 160;
const SLOT_X = TUBE_X - TOKEN / 2;
const SLOT_Y = [134, 105, 76];
/** Seconds: token k leaves at T[k], lands 0.42 s later. Same numbers as the CSS. */
const T = [0.9, 1.65, 2.4, 3.15, 3.9, 4.65];
const landing = (k: number) => T[k] + 0.42;
const midY = (slotIdx: number) => SLOT_Y[slotIdx] + TOKEN / 2;

export function StackScene() {
  return (
    <>
      {/* the tube lights up on every push and pop */}
      <rect className={s.stkGlow} x={122} y={66} width={76} height={110} rx={12} />

      <Pop d={0.1}>
        {/* the tray the input waits on */}
        <rect className={s.fl} x={HOME_X - 10} y={HOME_Y + TOKEN + 6} width={5 * PITCH + TOKEN + 20} height={4} rx={2} />
        {/* the tube: two walls and a floor */}
        <rect className={s.stkBack} x={TUBE_X - 25} y={72} width={50} height={92} rx={5} />
        <Block x={TUBE_X - 33} y={70} w={9} h={96} r={4.5} tone="s" lip={2} />
        <Block x={TUBE_X + 24} y={70} w={9} h={96} r={4.5} tone="s" lip={2} />
        <Block x={TUBE_X - 37} y={162} w={74} h={10} r={5} tone="s" lip={2} />
      </Pop>

      {/* the top of the stack */}
      <Pop d={0.2}>
        <g transform={`translate(${TUBE_X + 46} 0)`}>
          <g
            className={s.stkTop}
            style={steps(6, (n) => ({ y: n === 0 ? `${midY(0)}px` : size[n - 1] === 0 ? `${midY(0) + 8}px` : `${midY(size[n - 1] - 1)}px`, o: n === 0 || size[n - 1] === 0 ? 0 : 1, sc: n === 0 ? 0.3 : 1 }))}
          >
            <path className={s.fg} d="M-9 0L1 -6.5V6.5Z" />
            <rect className={s.fg} x={1} y={-2.2} width={9} height={4.4} rx={2.2} />
          </g>
        </g>
      </Pop>

      {INPUT.map((ch, k) => {
        const dx = SLOT_X - (HOME_X + k * PITCH);
        const dy = SLOT_Y[slot[k]] - HOME_Y;
        const landed = k < 3; // the poster: three pushed, three waiting
        return (
          <g key={k} transform={`translate(${HOME_X + k * PITCH} ${HOME_Y})`}>
            <g
              className={s.stkTok}
              style={{ animationName: s[`kStk${k}`], ['--dx' as string]: `${r2(dx)}px`, ['--dy' as string]: `${dy}px`, ...(landed ? { transform: `translate(${r2(dx)}px, ${dy}px)` } : {}) }}
            >
              <Block x={0} y={0} w={TOKEN} h={TOKEN} r={7} tone={TONE[ch as keyof typeof TONE]} label={ch} size={16} />
            </g>
          </g>
        );
      })}

      {/* the pairs that have closed, in the order they closed: ( ) then [ ] then { } */}
      <Pop d={0.15}>
        {[0, 1, 2].map((i) => (
          <rect key={i} className={s.stkSlot} x={26} y={92 + i * 28} width={56} height={24} rx={8} />
        ))}
      </Pop>
      {[3, 4, 5].map((k, i) => (
        <At key={k} t={[3.6, 4.4, 5.2][i]} style={{ opacity: 0 }}>
          <Block x={26} y={92 + i * 28} w={56} h={24} r={8} tone={TONE[INPUT[match[k] as number] as keyof typeof TONE]} label={`${INPUT[match[k] as number]}${INPUT[k]}`} size={14} lip={2.5} />
        </At>
      ))}

      {/* each pop: sparks and a ring where the pair met */}
      {[3, 4, 5].map((k) => (
        <g key={k}>
          <Burst x={TUBE_X} y={midY(slot[k])} t={landing(k) + 0.06} n={7} reach={26} />
          <Ring x={TUBE_X} y={midY(slot[k])} t={landing(k)} r={13} />
        </g>
      ))}
      {/* the stack is empty and the input is used up: balanced */}
      <rect className={s.stkTray} x={HOME_X - 10} y={HOME_Y + TOKEN + 6} width={5 * PITCH + TOKEN + 20} height={4} rx={2} />
      <Ring x={TUBE_X} y={midY(0)} t={landing(5) + 0.1} r={20} gold w={2.6} />
      <Burst x={TUBE_X} y={midY(0)} t={landing(5) + 0.12} n={10} reach={42} />
      <Coin x={TUBE_X} y={38} t={landing(5) + 0.14} r={12} poster={false} />
    </>
  );
}
