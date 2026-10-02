import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Pop, Ring, r1, r2, sec, steps, vars } from '../parts';

/**
 * Recursion — "A problem inside a problem".
 * The call tree of fib(4). The function really runs below (run()): every call
 * is a node that appears under the call that made it, and every return sends
 * its value back up the edge to its parent (gold dot) and stamps it on the
 * node. A ring follows the program counter, so the order is the depth-first
 * order — down to a leaf, back up, down the next branch — until the root gets
 * its answer, 3. Calls and returns are 0.2 s apart. The poster frame (reduced
 * motion) is the finished tree.
 */

interface Call {
  n: number;
  parent: Call | null;
  children: Call[];
  value: number;
  x: number;
  y: number;
  /** Index of the call event and of the return event in `events`. */
  callAt: number;
  retAt: number;
}
interface Ev {
  kind: 'call' | 'ret';
  call: Call;
}

const events: Ev[] = [];
const calls: Call[] = [];

/** fib(n), recording every call and return as it happens. */
function run(n: number, parent: Call | null): Call {
  const c: Call = { n, parent, children: [], value: 0, x: 0, y: 0, callAt: events.length, retAt: -1 };
  calls.push(c);
  parent?.children.push(c);
  events.push({ kind: 'call', call: c });
  c.value = n < 2 ? n : run(n - 1, c).value + run(n - 2, c).value;
  c.retAt = events.length;
  events.push({ kind: 'ret', call: c });
  return c;
}
const root = run(4, null);

// Lay the tree out: leaves left to right 52 apart, parents above the middle of their children.
let leaf = 0;
(function place(c: Call, depth: number) {
  c.y = 34 + depth * 40;
  if (c.children.length === 0) c.x = 46 + 52 * leaf++;
  else {
    c.children.forEach((k) => place(k, depth + 1));
    c.x = (c.children[0].x + c.children[c.children.length - 1].x) / 2;
  }
})(root, 0);

// The keyframes (kRcCur, kRcE0..7 in the CSS) are timed for fib(4): 9 calls, 18 events 0.2 s apart.
const CALL_TIMES = calls.filter((c) => c.parent).map((c) => r2(0.8 + 0.2 * c.callAt));
if (events.length !== 18 || CALL_TIMES.join() !== '1,1.2,1.4,1.8,2.4,3,3.2,3.6' || root.value !== 3) {
  throw new Error('recursion scene: the CSS is timed for the call tree of fib(4)');
}
const T0 = 0.8;
const DT = 0.2;
const when = (i: number) => T0 + DT * i;
const R = 11;

export function RecursionScene() {
  // The program counter after each event: a call is at its own node, a return is back at the caller.
  const pc = events.map((e) => (e.kind === 'call' ? e.call : (e.call.parent ?? e.call)));
  const nonRoot = calls.filter((c) => c.parent);
  return (
    <>
      {/* the call being worked out, and its answer */}
      <Pop d={0.1}>
        <Block x={16} y={24} w={62} h={22} r={7} tone="g" label="fib(4)" size={11} />
      </Pop>
      <At t={when(17)}>
        <Block x={84} y={24} w={38} h={22} r={7} tone="g" label={`=${root.value}`} size={12} />
      </At>

      {/* the edges, drawn as each call is made */}
      {nonRoot.map((c, i) => (
        <path key={`e${i}`} className={s.rcEdge} d={`M${c.parent!.x} ${c.parent!.y}L${c.x} ${c.y}`} pathLength={1} style={{ animationName: s[`kRcE${i}`] }} />
      ))}

      {/* each return sends its value up the edge */}
      {nonRoot.map((c, i) => (
        <path key={`p${i}`} className={s.rcPulse} d={`M${c.x} ${c.y}L${c.parent!.x} ${c.parent!.y}`} pathLength={1} style={vars({ '--t': sec(when(c.retAt) - 0.04) })} />
      ))}

      {/* the calls: a node when the call is made, its value when it returns */}
      {calls.map((c, i) => (
        <g key={i}>
          <At t={when(c.callAt)}>
            <g transform={`translate(${c.x} ${c.y})`}>
              <circle className={s.rcLip} cy={2.8} r={R} />
              <circle className={s.fa} r={R} />
              <circle className={s.fw} cx={-3.6} cy={-3.8} r={2} opacity={0.5} />
              <text y={0.5} fontSize={11}>
                {c.n}
              </text>
            </g>
          </At>
          <At t={when(c.retAt)}>
            <g transform={`translate(${r2(c.x + R + 3)} ${r2(c.y - 7)})`}>
              <Block x={0} y={0} w={c === root ? 26 : 22} h={15} r={6} tone="g" lip={2} label={c.value} size={c === root ? 10.5 : 9.5} />
            </g>
          </At>
        </g>
      ))}

      {/* the program counter: a ring that goes where the control goes (state n = after n events; 0 and the last are out of sight) */}
      <g
        className={s.rcCur}
        style={steps(events.length + 1, (n) => {
          const node = pc[Math.max(0, Math.min(n, events.length) - 1)];
          return { x: `${r1(node.x)}px`, y: `${r1(node.y)}px`, o: n === 0 || n === events.length + 1 ? 0 : 1, c: n === 0 ? 0.6 : 1 };
        })}
      >
        <circle className={s.rcCurRing} r={R + 5} />
      </g>

      {/* payoff: fib(4) = 3 */}
      <Ring x={root.x} y={root.y} t={when(17)} r={16} gold w={2.4} />
      <Burst x={root.x} y={root.y} t={when(17)} n={10} reach={40} />
      <Coin x={root.x + 52} y={root.y + 6} t={when(17) + 0.05} r={11} />
    </>
  );
}
