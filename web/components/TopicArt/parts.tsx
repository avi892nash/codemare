import type { CSSProperties, ReactNode } from 'react';

/**
 * Small building blocks the scenes share. Server-safe, no state. Every motion
 * and every color lives in topicArt.module.css; these only emit the (short)
 * markup it hooks onto, as data-* attributes — a hashed class name on each of
 * a scene's ~170 shapes would be the biggest part of its HTML:
 *   data-b="a|s|g|h|c|p|v|o|k"  a block and its palette
 *   data-p="0…7" / data-a="0…22" intro (0.07 s steps) / appears mid-loop (0.2 s steps from 0.8 s)
 *   data-u                       grows from its bottom edge
 *   data-k="0…15"                one piece of confetti
 *   data-r, data-c, data-h       pulse ring, +1 coin, halo (add "g" for gold)
 */

/** Inline custom properties (`--t: 1.2s`) for the keyframes in topicArt.module.css. */
export function vars(o: Record<string, string | number>): CSSProperties {
  return o as CSSProperties;
}

/**
 * Per-step custom properties for the steppers in the CSS:
 * steps(2, (j) => ({ x: `${j * 10}px`, o: j })) → { --x0: 0px, --o0: 0, --x1: 10px, --o1: 1, --x2: … }.
 */
export function steps(count: number, f: (j: number) => Record<string, string | number>, extra: Record<string, string | number> = {}): CSSProperties {
  const out: Record<string, string | number> = {};
  for (let j = 0; j <= count; j++) for (const [k, v] of Object.entries(f(j))) out[`--${k}${j}`] = v;
  return { ...out, ...extra } as CSSProperties;
}

/** Round to 1 decimal so generated coordinates stay short in the markup. */
export const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Round to 2 decimals (for things a tenth of a unit would visibly move). */
export const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Seconds as a CSS time. */
export const sec = (n: number): string => `${r2(n)}s`;

type Tone = 'a' | 's' | 'g' | 'h' | 'c' | 'p' | 'v' | 'o' | 'k';

interface BlockProps {
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Corner radius. */
  r?: number;
  /** a = the topic hue · s = empty surface · g = gold · h = hot · c = cool · p = pink · v = violet · o = orange · k = green. */
  tone?: Tone;
  label?: string | number;
  /** Font size of the label. */
  size?: number;
  /** Label baseline offset from the top (default: the middle). */
  ly?: number;
  /** White label with a dark edge (readable on any shade). */
  outline?: boolean;
  /** Depth of the lip under the face. */
  lip?: number;
  style?: CSSProperties;
  /** More shapes, in the block's own coordinates (0,0 is its top-left corner). */
  children?: ReactNode;
}

/**
 * A chunky arcade block: a darker lip, the face and (on blocks big enough to
 * show it) a highlight — the first rects, painted by CSS — an optional label,
 * and whatever else belongs on it. To animate one, wrap it in a group — the block's own `transform`
 * attribute is its position.
 */
export function Block({ x, y, w = 18, h = 22, r = 5, tone = 'a', label, size = 8, ly, outline, lip = 3, style, children }: BlockProps) {
  return (
    <g data-b={tone} data-o={outline ? '' : undefined} transform={`translate(${r1(x)} ${r1(y)})`} style={style}>
      <rect y={lip} width={w} height={h} rx={r} />
      <rect width={w} height={h} rx={r} />
      {w >= 24 && h >= 20 && <rect x={r1(r * 0.5 + 1)} y={1.5} width={r1(Math.max(2, w - r - 2))} height={2} rx={1} />}
      {label !== undefined && (
        <text x={r1(w / 2)} y={r1((ly ?? h / 2) + 0.5)} fontSize={size}>
          {label}
        </text>
      )}
      {children}
    </g>
  );
}

/** The +1 token that pops when the goal is hit. `t` = when (seconds into the loop). `poster={false}` keeps it out of the still frame. */
export function Coin({ x, y, t, r = 10, poster = true }: { x: number; y: number; t: number; r?: number; poster?: boolean }) {
  return (
    <g transform={`translate(${r1(x)} ${r1(y)})`}>
      <g data-c="" style={vars({ '--t': sec(t), ...(poster ? {} : { opacity: 0 }) })}>
        <circle cy={1.7} r={r} />
        <circle r={r} />
        <circle r={r1(r * 0.7)} />
        <text y={0.6} fontSize={r1(r * 0.85)}>
          +1
        </text>
      </g>
    </g>
  );
}

/**
 * A burst of confetti from (x, y) at `t` seconds: `n` pieces (up to 16) flying
 * out about `reach` units. Each piece's direction and color come from the CSS
 * (data-k), so a burst is a handful of short circles.
 */
export function Burst({ x, y, t, n = 12, reach = 30 }: { x: number; y: number; t: number; n?: number; reach?: number }) {
  return (
    <g transform={`translate(${r1(x)} ${r1(y)})`} style={vars({ '--t': sec(t), '--rr': `${reach}px` })}>
      {Array.from({ length: Math.min(16, n) }, (_, i) => (
        <circle key={i} data-k={i} r={i % 3 ? 1.7 : 2.4} />
      ))}
    </g>
  );
}

/** A pulse ring around (x, y), starting at `t`. */
export function Ring({ x, y, t, r = 12, gold = false, w = 2 }: { x: number; y: number; t: number; r?: number; gold?: boolean; w?: number }) {
  return <circle data-r={gold ? 'g' : ''} cx={r1(x)} cy={r1(y)} r={r} strokeWidth={w} style={vars({ '--t': sec(t) })} />;
}

/** A soft halo: concentric translucent discs (cheap, id-free glow). */
export function Halo({ x, y, r, gold = false, style }: { x: number; y: number; r: number; gold?: boolean; style?: CSSProperties }) {
  return (
    <g data-h={gold ? 'g' : ''} transform={`translate(${r1(x)} ${r1(y)})`} style={style}>
      <circle r={r} />
      <circle r={r1(r * 0.62)} />
      <circle r={r1(r * 0.3)} />
    </g>
  );
}

/**
 * Wraps children in a group that grows in at `d` seconds (0 to 0.5, in 0.07 s
 * steps) — the intro of everything that is on stage from the start. (The
 * whole scene fades out at the end of the loop, see `.svg` in the CSS.)
 */
export function Pop({ d = 0, up = false, children, style }: { d?: number; up?: boolean; children: ReactNode; style?: CSSProperties }) {
  const g = Math.min(7, Math.max(0, Math.round(d / 0.07)));
  return (
    <g data-p={g} data-u={up ? '' : undefined} style={style}>
      {children}
    </g>
  );
}

/** The first moment `At` can place something (seconds into the loop), and the grid step. */
export const AT_START = 0.8;
export const AT_STEP = 0.2;

/**
 * Wraps children in a group that pops in at `t` seconds into the loop — on the
 * 0.2 s grid from 0.8 s to 5.2 s — and stays until the end. For things that
 * show up mid-story: a token pushed, a node reached, a number computed.
 */
export function At({ t, up = false, children, style }: { t: number; up?: boolean; children: ReactNode; style?: CSSProperties }) {
  const g = Math.min(22, Math.max(0, Math.round((t - AT_START) / AT_STEP)));
  return (
    <g data-a={g} data-u={up ? '' : undefined} style={style}>
      {children}
    </g>
  );
}

/**
 * Makes whatever it wraps hop at each of the `at` seconds (an arc and a
 * squash on landing) and, if given, jump for joy at `joy`: one nested group per
 * hop, each playing the shared kHop / kJoy event at its own delay.
 */
export function Hop({ at, joy, children }: { at: number[]; joy?: number; children: ReactNode }) {
  let node: ReactNode = children;
  for (const t of [...at].reverse()) {
    node = (
      <g data-hop="" style={vars({ '--t': sec(t) })}>
        {node}
      </g>
    );
  }
  if (joy !== undefined) {
    node = (
      <g data-hop="j" style={vars({ '--t': sec(joy) })}>
        {node}
      </g>
    );
  }
  return <>{node}</>;
}
