/**
 * Lesson markdown pre-pass (spec §6.2). Splits a lesson body into blocks:
 * plain GitHub-flavored markdown (rendered later by react-markdown +
 * rehype-sanitize) and the custom blocks that map onto ui-kit components.
 *
 *   ```python run                    → RunnableCodeBlock (any language + `run`;
 *   ```python run stdin="3\n4"          `stdin` pre-fills the input box, a bare
 *                                       `stdin` shows an empty one)
 *   ```cpp title=bfs.cpp             → CodeBlock with a filename
 *   ```js                            → CodeBlock (every fenced block is taken
 *                                       here, so `:::` / `$$` inside code stay code)
 *   :::callout{kind=complexity}      → Callout (kind: complexity | pitfall | note;
 *   …markdown, code, formulas…         optional title="…", time="O(n)", space="O(1)")
 *   :::
 *   $$                               → Formula block ($$ … $$ on one line works too)
 *   a_i + a_j
 *   $$
 *   :::viz{id=binary-search}         → VisualizationFrame from the Viz registry
 *   :::question{slug=two-sum}        → link card to /problems/two-sum
 *
 * Pure and dependency-free. Hostile input never becomes markup here: every
 * attribute is validated against an allow-list pattern (bad values drop the
 * attribute or the whole block) and all text reaches React as strings.
 * Markdown chunks are sanitized by the renderer (see ./config.ts).
 */

export const CALLOUT_KINDS = ['complexity', 'pitfall', 'note'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export interface MarkdownBlock {
  type: 'markdown';
  md: string;
}
export interface CodeBlockNode {
  type: 'code';
  code: string;
  /** Language id as written (`py`, `cpp` …), or null. */
  lang: string | null;
  /** Rendered as a RunnableCodeBlock. */
  run: boolean;
  /** Filename shown in the header (`title=`). */
  title: string | null;
  /** Runnable only: true = empty stdin box, a string pre-fills it, null = none. */
  stdin: string | true | null;
}
export interface CalloutBlock {
  type: 'callout';
  kind: CalloutKind;
  title: string | null;
  time: string | null;
  space: string | null;
  children: LessonBlock[];
}
export interface FormulaBlock {
  type: 'formula';
  tex: string;
}
export interface VizBlock {
  type: 'viz';
  id: string;
}
export interface QuestionBlock {
  type: 'question';
  slug: string;
}

export type LessonBlock = MarkdownBlock | CodeBlockNode | CalloutBlock | FormulaBlock | VizBlock | QuestionBlock;

/** kebab-case: the shape of every slug and viz id. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANG_RE = /^[A-Za-z0-9_+#.-]{1,24}$/;
const MAX_ATTR = 160;
const MAX_STDIN = 2000;
/** Nesting cap for callouts inside callouts (keeps recursion bounded). */
const MAX_DEPTH = 4;

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const DIRECTIVE = /^ {0,3}:::([A-Za-z][\w-]*)\s*(\{.*\})?\s*$/;
const DIRECTIVE_CLOSE = /^ {0,3}:::\s*$/;
const MATH_FENCE = /^ {0,3}\$\$\s*$/;
const MATH_INLINE_BLOCK = /^ {0,3}\$\$(.+?)\$\$\s*$/;

// ─── Attributes ───────────────────────────────────────────────────────────

/**
 * `key=value key="quoted value" key='v' flag` → record. Keys are
 * identifiers; values stop at whitespace unless quoted; `\"`, `\\` and `\n`
 * are the only escapes. Anything unparseable is skipped, never thrown.
 */
export function parseAttrs(src: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    const keyMatch = /^[A-Za-z][\w-]*/.exec(src.slice(i));
    if (!keyMatch) {
      // Skip one junk token.
      while (i < n && !/\s/.test(src[i])) i++;
      continue;
    }
    const key = keyMatch[0].toLowerCase();
    i += keyMatch[0].length;
    if (src[i] !== '=') {
      if (i >= n || /\s/.test(src[i])) out[key] = true;
      else while (i < n && !/\s/.test(src[i])) i++; // `key!junk` → skip
      continue;
    }
    i++; // '='
    let value = '';
    const q = src[i];
    if (q === '"' || q === "'") {
      i++;
      let closed = false;
      while (i < n) {
        const c = src[i];
        if (c === '\\' && i + 1 < n) {
          const e = src[i + 1];
          value += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
          continue;
        }
        if (c === q) {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) continue; // unterminated quote: drop the attribute
    } else {
      while (i < n && !/\s/.test(src[i])) value += src[i++];
    }
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** Strip control characters (keeps \n and \t) — nothing invisible reaches the UI. */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '');
}

function textAttr(v: string | true | undefined, max = MAX_ATTR): string | null {
  if (typeof v !== 'string') return null;
  const t = clean(v).replace(/\s+/g, ' ').trim();
  return t && t.length <= max ? t : null;
}

function slugAttr(v: string | true | undefined): string | null {
  return typeof v === 'string' && v.length <= 80 && SLUG_RE.test(v) ? v : null;
}

function directiveAttrs(raw: string | undefined): Record<string, string | true> {
  if (!raw) return {};
  return parseAttrs(raw.slice(1, -1));
}

// ─── Code fences ──────────────────────────────────────────────────────────

/** The info string of a fence: `python run title=a.py stdin="1 2"`. */
export function parseFenceInfo(info: string): Pick<CodeBlockNode, 'lang' | 'run' | 'title' | 'stdin'> {
  const trimmed = clean(info).trim();
  const firstSpace = trimmed.search(/\s/);
  const first = firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
  // A leading `key=value` means there is no language token.
  const hasLang = first !== '' && !first.includes('=');
  const lang = hasLang && LANG_RE.test(first) ? first : null;
  const attrs = parseAttrs(hasLang ? trimmed.slice(first.length) : trimmed);
  const run = attrs.run === true || attrs.run === 'true';
  let stdin: string | true | null = null;
  if (run) {
    if (attrs.stdin === true) stdin = true;
    else if (typeof attrs.stdin === 'string' && attrs.stdin.length <= MAX_STDIN) stdin = clean(attrs.stdin);
  }
  return { lang, run, title: textAttr(attrs.title, 80), stdin };
}

// ─── Block parser ─────────────────────────────────────────────────────────

interface Cursor {
  lines: string[];
  i: number;
}

function flush(buffer: string[], out: LessonBlock[]): void {
  const md = buffer.join('\n');
  buffer.length = 0;
  if (md.trim()) out.push({ type: 'markdown', md });
}

/** Consume a fenced code block starting at the cursor (the opening line). */
function readFence(c: Cursor, m: RegExpExecArray): CodeBlockNode {
  const indent = m[1].length;
  const fence = m[2];
  const info = m[3];
  c.i++;
  const body: string[] = [];
  const closeRe = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
  while (c.i < c.lines.length) {
    const line = c.lines[c.i];
    if (closeRe.test(line)) {
      c.i++;
      break;
    }
    // Remove up to `indent` spaces of the fence's own indentation (CommonMark).
    body.push(indent ? line.replace(new RegExp(`^ {0,${indent}}`), '') : line);
    c.i++;
  }
  return { type: 'code', code: clean(body.join('\n')), ...parseFenceInfo(info) };
}

function parseBlocks(c: Cursor, depth: number): { blocks: LessonBlock[]; closed: boolean } {
  const out: LessonBlock[] = [];
  const buffer: string[] = [];

  while (c.i < c.lines.length) {
    const line = c.lines[c.i];

    // Fenced code — must run first so nothing inside a fence is a directive.
    const fence = FENCE_OPEN.exec(line);
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      flush(buffer, out);
      out.push(readFence(c, fence));
      continue;
    }

    // The end of the container we are in.
    if (depth > 0 && DIRECTIVE_CLOSE.test(line)) {
      flush(buffer, out);
      c.i++;
      return { blocks: out, closed: true };
    }

    const dir = DIRECTIVE.exec(line);
    if (dir) {
      const name = dir[1].toLowerCase();
      const attrs = directiveAttrs(dir[2]);
      if (name === 'callout') {
        flush(buffer, out);
        c.i++;
        const kind = CALLOUT_KINDS.find((k) => k === attrs.kind) ?? 'note';
        const inner =
          depth + 1 > MAX_DEPTH
            ? { blocks: [] as LessonBlock[], closed: true }
            : parseBlocks(c, depth + 1);
        out.push({
          type: 'callout',
          kind,
          title: textAttr(attrs.title),
          time: textAttr(attrs.time, 40),
          space: textAttr(attrs.space, 40),
          children: inner.blocks,
        });
        continue;
      }
      if (name === 'viz' || name === 'question') {
        flush(buffer, out);
        c.i++;
        const value = slugAttr(name === 'viz' ? attrs.id : attrs.slug);
        if (value) out.push(name === 'viz' ? { type: 'viz', id: value } : { type: 'question', slug: value });
        continue;
      }
      // Unknown directive: leave the line to markdown (rendered as text).
    }

    // A stray closing fence at the top level (e.g. after a leaf directive).
    if (depth === 0 && DIRECTIVE_CLOSE.test(line)) {
      c.i++;
      continue;
    }

    const oneLine = MATH_INLINE_BLOCK.exec(line);
    if (oneLine && oneLine[1].trim()) {
      flush(buffer, out);
      out.push({ type: 'formula', tex: clean(oneLine[1]).trim() });
      c.i++;
      continue;
    }
    if (MATH_FENCE.test(line)) {
      // Find the closing $$; unclosed → plain text, never swallow the rest.
      let j = c.i + 1;
      while (j < c.lines.length && !MATH_FENCE.test(c.lines[j])) j++;
      if (j < c.lines.length) {
        const tex = clean(c.lines.slice(c.i + 1, j).join('\n')).trim();
        flush(buffer, out);
        if (tex) out.push({ type: 'formula', tex });
        c.i = j + 1;
        continue;
      }
    }

    buffer.push(line);
    c.i++;
  }

  flush(buffer, out);
  return { blocks: out, closed: false };
}

/** Parse a lesson body into blocks (see the module comment for the syntax). */
export function parseLesson(md: string): LessonBlock[] {
  const text = String(md ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  return parseBlocks({ lines: text.split('\n'), i: 0 }, 0).blocks;
}

// ─── Queries over parsed blocks ──────────────────────────────────────────

/** Depth-first walk over blocks and callout children. */
export function* walkBlocks(blocks: readonly LessonBlock[]): Generator<LessonBlock> {
  for (const b of blocks) {
    yield b;
    if (b.type === 'callout') yield* walkBlocks(b.children);
  }
}

/** Question slugs referenced by `:::question` blocks, in first-seen order. */
export function questionSlugs(blocks: readonly LessonBlock[]): string[] {
  const seen = new Set<string>();
  for (const b of walkBlocks(blocks)) if (b.type === 'question') seen.add(b.slug);
  return [...seen];
}

/** Visualization ids referenced by `:::viz` blocks, in first-seen order. */
export function vizIds(blocks: readonly LessonBlock[]): string[] {
  const seen = new Set<string>();
  for (const b of walkBlocks(blocks)) if (b.type === 'viz') seen.add(b.id);
  return [...seen];
}
