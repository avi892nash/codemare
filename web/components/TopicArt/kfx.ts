// Dev tool: writes the @keyframes of topicArt.module.css from their specs.
//
// A scene tells its story in seconds ("the pointer hops at 2.1 s"); a
// @keyframes block wants percentages of the loop, with every state held across
// the gaps. Doing that by hand for a dozen elements is how a scene drifts out
// of step with its own algorithm. So each block (or family of blocks) in the
// stylesheet is written once, as a spec in a comment, in seconds, and this tool
// generates the @keyframes right below it. After editing a spec:
//
//   npx tsx components/TopicArt/kfx.ts components/TopicArt/topicArt.module.css
//
// (lib/topicArt.test.ts fails while the generated blocks are out of date.)
//
// The spec language, as it appears in the stylesheet:
//
//   /*@L 7*/                   once: the loop length in seconds (LOOP_MS / 1000)
//
//   /*@kf kRing                one @keyframes block, one stop per line:
//     def S transform: translate(var(--x{n}), 0)    a macro, used as S(2) in a stop (n = 2)
//     0    S(0)                time in seconds, then what holds from there
//     1.6  =                   "=" repeats the previous stop
//     1.9  S(1) | cubic-bezier(.3,1.5,.6,1)         easing from this stop to the NEXT one
//   */
//
//   /*@kfx kPop{i} 0..7        a family: {i} in the name and {{expr}} in the body use i
//     {{i*0.07}}  =  | ease-out
//   */
//
// The generated block sits between /*@gen name*/ and /*@end*/ right under its
// spec and is replaced each run; a later stop at the same time replaces an
// earlier one, and a state that repeats over several stops is written once, with
// all of their percentages. Times are in the comment after each stop.

import { readFileSync, writeFileSync } from 'node:fs';

interface Stop {
  t: number;
  decl: string;
  ease: string | undefined;
}

const DEFAULT_LOOP = 7;

// The loop length in seconds the stylesheet declares with its @L line (7 when it has none).
export function loopSeconds(css: string): number {
  const m = css.match(/\/\*@L\s+([\d.]+)\s*\*\//);
  return m ? Number(m[1]) : DEFAULT_LOOP;
}

function expand(name: string, body: string, loop: number): string {
  const pct = (t: number) => +((t / loop) * 100).toFixed(3);
  const macros: Record<string, string> = {};
  let prev = '';
  let stops: Stop[] = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .filter((l) => {
      const d = l.match(/^def\s+(\w+)\s+(.*)$/);
      if (d) {
        macros[d[1]] = d[2];
        return false;
      }
      return true;
    })
    .map((l) => {
      const m = l.match(/^([\d.]+)\s+(.*)$/);
      if (!m) throw new Error(`bad stop in ${name}: ${l}`);
      const [rawDecl, ease] = m[2].split('|').map((x) => x.trim());
      let decl = rawDecl.replace(/;\s*$/, '');
      const call = decl.match(/^(\w+)\((\w+)\)$/);
      if (decl === '=') decl = prev;
      else if (call && macros[call[1]]) decl = macros[call[1]].replace(/\{n\}/g, call[2]);
      prev = decl;
      return { t: Number(m[1]), decl, ease };
    });
  stops = stops.filter((s, i) => !(i + 1 < stops.length && stops[i + 1].t === s.t));
  if (stops[0].t > 0) stops.unshift({ ...stops[0], t: 0, ease: undefined });
  if (stops[stops.length - 1].t < loop) stops.push({ ...stops[stops.length - 1], t: loop, ease: undefined });

  const groups: Array<{ decl: string; ease: string | undefined; ts: number[] }> = [];
  for (const s of stops) {
    const g = groups[groups.length - 1];
    if (g && g.decl === s.decl && g.ease === s.ease) g.ts.push(s.t);
    else groups.push({ decl: s.decl, ease: s.ease, ts: [s.t] });
  }
  const lines = groups.map((g) => {
    const selector = [...new Set(g.ts.map(pct))].map((p) => `${p}%`).join(', ');
    const decls = g.decl
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean);
    if (g.ease) decls.push(`animation-timing-function: ${g.ease}`);
    const first = +g.ts[0].toFixed(3);
    const last = +g.ts[g.ts.length - 1].toFixed(3);
    return `  ${selector} { ${decls.join('; ')}; } /* ${g.ts.length > 1 ? `${first}–${last}s` : `${first}s`} */`;
  });
  return `@keyframes ${name} {\n${lines.join('\n')}\n}`;
}

// A spec's generated block, if it already has one, is swallowed and written again.
const GENERATED = String.raw`(?:\s*\/\*@gen\s+\S+\*\/[\s\S]*?\/\*@end\*\/)?`;
const FAMILY = new RegExp(String.raw`\/\*@kfx\s+(\S+)\s+(\d+)\.\.(\d+)\n([\s\S]*?)\*\/` + GENERATED, 'g');
const SINGLE = new RegExp(String.raw`\/\*@kf\s+(\S+)\n([\s\S]*?)\*\/` + GENERATED, 'g');

/** The stylesheet with the generated @keyframes of every spec rewritten from it. Idempotent. */
export function expandKeyframes(css: string): string {
  const loop = loopSeconds(css);
  return css
    .replace(FAMILY, (_all, name: string, from: string, to: string, body: string) => {
      const blocks: string[] = [];
      for (let i = Number(from); i <= Number(to); i++) {
        const filled = body.replace(/\{\{(.+?)\}\}/g, (_m, expr: string) => String(+Number(new Function('i', `return ${expr}`)(i)).toFixed(4)));
        blocks.push(expand(name.replace(/\{i\}/g, String(i)), filled, loop));
      }
      return `/*@kfx ${name} ${from}..${to}\n${body}*/\n/*@gen ${name}*/\n${blocks.join('\n')}\n/*@end*/`;
    })
    .replace(SINGLE, (_all, name: string, body: string) => `/*@kf ${name}\n${body}*/\n/*@gen ${name}*/\n${expand(name, body, loop)}\n/*@end*/`);
}

if (process.argv[1]?.endsWith('kfx.ts')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: npx tsx components/TopicArt/kfx.ts components/TopicArt/topicArt.module.css');
    process.exit(1);
  }
  writeFileSync(file, expandKeyframes(readFileSync(file, 'utf8')));
  console.log(`expanded the keyframes in ${file}`);
}
