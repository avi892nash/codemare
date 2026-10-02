import s from '../topicArt.module.css';
import { At, Block, Burst, Coin, Pop, Ring, r2, steps } from '../parts';

/**
 * Dynamic programming — "Remember it, don't redo it".
 * How many ways can a walker cross a 4×5 grid moving only right or down?
 * Each cell is the sum of the two cells that lead into it — the one above and
 * the one to the left — so the table is filled once, row by row, and every
 * answer is read back from the table instead of being recomputed. The grid is
 * the real recurrence (below); an L-shaped frame hops to each cell to show the
 * two it adds. Cells glow brighter as the numbers grow, and the corner is the
 * answer, 35. The poster frame (reduced motion) is the finished table.
 */

const ROWS = 4;
const COLS = 5;

/** paths[r][c]: ways to reach (r, c) — 1 along the top and left edges, else above + left. */
function fillTable(): number[][] {
  const t: number[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(1));
  for (let r = 1; r < ROWS; r++) for (let c = 1; c < COLS; c++) t[r][c] = t[r - 1][c] + t[r][c - 1];
  return t;
}
const table = fillTable();
const ANSWER = table[ROWS - 1][COLS - 1];
if (ANSWER !== 35) throw new Error('dynamic-programming scene: expected C(7,3) = 35 paths');

const CW = 44;
const CH = 26;
const PX = 50;
const PY = 31;
const X0 = (320 - ((COLS - 1) * PX + CW)) / 2;
const Y0 = 46;
const cellX = (c: number) => X0 + c * PX;
const cellY = (r: number) => Y0 + r * PY;

/** The interior cells in the order they are filled (row by row): the frame visits each. */
const ORDER: Array<[number, number]> = [];
for (let r = 1; r < ROWS; r++) for (let c = 1; c < COLS; c++) ORDER.push([r, c]);
// kDpL in the CSS has one state per interior cell (+ before and after).
if (ORDER.length !== 12) throw new Error('dynamic-programming scene: the CSS frame is timed for 12 interior cells');

const FILL0 = 1.0; // the frame reaches the first interior cell; each next one 0.2 s later; the number pops 0.2 s after the frame
const FILL_DT = 0.2;
const REVEAL = 3.8; // the answer lights up gold

/** Cells fuller than this are deep enough for the white digits; paler ones (1 to 6) take the theme's text color. */
const LIGHT_BELOW = 62;

/** How "full" a cell looks: grows with the log of its value, so 1 is a faint tint and 35 is full. */
const heat = (v: number) => 18 + (82 * Math.log(v)) / Math.log(ANSWER);
const cellStyle = (v: number) => {
  const p = r2(heat(v));
  return {
    ['--f' as string]: `color-mix(in oklab, var(--a) ${p}%, var(--art-surface-hi))`,
    ['--l' as string]: `color-mix(in oklab, var(--a-lo) ${p}%, var(--surf-lo))`,
    ['--h' as string]: `color-mix(in oklab, var(--a-hi) ${p}%, var(--art-surface-hi))`,
  };
};
const Cell = ({ r, c, gold = false }: { r: number; c: number; gold?: boolean }) => {
  const v = table[r][c];
  return (
    <g className={heat(v) < LIGHT_BELOW && !gold ? s.dpLow : undefined}>
      <Block x={cellX(c)} y={cellY(r)} w={CW} h={CH} r={8} tone={gold ? 'g' : 'a'} label={v} size={13} style={gold ? undefined : cellStyle(v)} />
    </g>
  );
};

export function DynamicProgrammingScene() {
  const [ar, ac] = [ROWS - 1, COLS - 1];
  const acx = cellX(ac) + CW / 2;
  const acy = cellY(ar) + CH / 2;
  return (
    <>
      {/* the cells still to be computed */}
      <Pop d={0.1}>
        {ORDER.map(([r, c]) => (
          <Block key={`${r}-${c}`} x={cellX(c)} y={cellY(r)} w={CW} h={CH} r={8} tone="s" lip={3} />
        ))}
      </Pop>

      {/* the edges: 1 way to reach any cell along the top and the left */}
      {table.flatMap((row, r) =>
        row.map((_, c) =>
          r === 0 || c === 0 ? (
            <Pop key={`${r}-${c}`} d={Math.min(0.5, 0.05 * (r + c))} up>
              <Cell r={r} c={c} />
            </Pop>
          ) : null,
        ),
      )}

      {/* the interior, filled one by one: each number is the sum of the two cells the frame outlines */}
      {ORDER.map(([r, c], k) => (
        <At key={`${r}-${c}`} t={FILL0 + FILL_DT * (k + 1)} up>
          <Cell r={r} c={c} />
        </At>
      ))}

      {/* the frame: the target cell with the cell above and the one to its left */}
      <g
        className={s.dpFrame}
        style={steps(13, (n) => {
          const [r, c] = ORDER[Math.min(ORDER.length - 1, Math.max(0, n - 1))];
          return { x: `${cellX(c)}px`, y: `${cellY(r)}px`, o: n === 0 || n === 13 ? 0 : 1, sc: n === 0 ? 0.6 : 1 };
        })}
      >
        <rect x={-3} y={-PY - 3} width={CW + 6} height={PY + CH + 6} rx={9} />
        <rect x={-PX - 3} y={-3} width={CW + 6} height={CH + 6} rx={9} />
      </g>

      {/* the answer */}
      <At t={REVEAL} up>
        <Block x={cellX(ac)} y={cellY(ar)} w={CW} h={CH} r={8} tone="g" label={ANSWER} size={15} />
      </At>
      <Ring x={acx} y={acy} t={REVEAL} r={18} gold w={2.4} />
      <Burst x={acx} y={acy} t={REVEAL} n={10} reach={40} />
      <Coin x={acx} y={30} t={REVEAL + 0.1} r={11} />
    </>
  );
}
