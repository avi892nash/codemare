/**
 * A small TeX-subset → MathML renderer for lesson formulas ($$ … $$). No
 * KaTeX: MathML Core renders natively in every current browser and is read
 * by screen readers. Covers what DSA lessons use: sub/superscripts, \frac,
 * \sqrt, \binom, \sum/\prod/\lim/\max with limits, \log & co, Greek, common
 * relations/arrows, floor/ceil, \left…\right, \text, accents (\hat, \bar,
 * \vec…), spacing, and the cases / aligned / (p|b|v)matrix environments.
 * Unknown commands render as their name rather than failing.
 *
 * Throws TexError on malformed input; <Formula> falls back to the raw TeX.
 */
import { createElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';

export class TexError extends Error {}

type Tok =
  | { t: 'cmd'; v: string }
  | { t: 'text'; v: string; cmd: string }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'sup' }
  | { t: 'sub' }
  | { t: 'amp' }
  | { t: 'nl' }
  | { t: 'num'; v: string }
  | { t: 'char'; v: string };

const RAW_TEXT = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox', 'operatorname']);

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      if (next === '\\') { out.push({ t: 'nl' }); i += 2; continue; }
      const m = /^[a-zA-Z]+/.exec(src.slice(i + 1));
      if (m) {
        i += 1 + m[0].length;
        if (RAW_TEXT.has(m[0])) {
          while (src[i] === ' ') i++;
          if (src[i] === '{') {
            let depth = 1;
            let j = i + 1;
            for (; j < src.length && depth > 0; j++) {
              if (src[j] === '{') depth++;
              else if (src[j] === '}') depth--;
            }
            if (depth !== 0) throw new TexError('Unbalanced braces in \\text');
            out.push({ t: 'text', v: src.slice(i + 1, j - 1), cmd: m[0] });
            i = j;
            continue;
          }
        }
        out.push({ t: 'cmd', v: m[0] });
        continue;
      }
      if (next === undefined) throw new TexError('Trailing backslash');
      out.push({ t: 'cmd', v: next });
      i += 2;
      continue;
    }
    if (c === '{') { out.push({ t: 'open' }); i++; continue; }
    if (c === '}') { out.push({ t: 'close' }); i++; continue; }
    if (c === '^') { out.push({ t: 'sup' }); i++; continue; }
    if (c === '_') { out.push({ t: 'sub' }); i++; continue; }
    if (c === '&') { out.push({ t: 'amp' }); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i));
      const v = m ? m[0] : c;
      out.push({ t: 'num', v });
      i += v.length;
      continue;
    }
    out.push({ t: 'char', v: c });
    i++;
  }
  return out;
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** Relations, arrows, binary operators and delimiters → <mo>. */
const OPS: Record<string, string> = {
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃',
  cong: '≅', propto: '∝', ll: '≪', gg: '≫', prec: '≺', succ: '≻', preceq: '⪯', succeq: '⪰',
  cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  oplus: '⊕', otimes: '⊗', wedge: '∧', land: '∧', vee: '∨', lor: '∨', neg: '¬', lnot: '¬',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', forall: '∀', exists: '∃', mid: '∣', parallel: '∥', perp: '⊥', angle: '∠',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖',
  '|': '‖', '{': '{', '}': '}', lbrace: '{', rbrace: '}', ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮',
  ddots: '⋱', colon: ':', '#': '#', '%': '%', '&': '&', '_': '_', '$': '$', prime: '′',
};

/** Symbols that are identifiers rather than operators. */
const IDENTS: Record<string, string> = {
  infty: '∞', partial: '∂', nabla: '∇', emptyset: '∅', varnothing: '∅', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', top: '⊤', bot: '⊥', triangle: '△', square: '□', deg: '°',
};

const BIG_OPS: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', oint: '∮', bigcup: '⋃', bigcap: '⋂',
  bigoplus: '⨁', bigotimes: '⨂', bigvee: '⋁', bigwedge: '⋀',
};

const FUNCS = new Set([
  'log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh',
  'cosh', 'tanh', 'max', 'min', 'lim', 'sup', 'inf', 'gcd', 'lcm', 'det', 'arg', 'dim', 'ker', 'deg', 'Pr',
  'mod', 'bmod', 'argmax', 'argmin', 'limsup', 'liminf',
]);
const LIMIT_FUNCS = new Set(['max', 'min', 'lim', 'sup', 'inf', 'argmax', 'argmin', 'limsup', 'liminf', 'Pr']);

const SPACES: Record<string, string> = {
  ',': '0.1667em', ':': '0.2222em', '>': '0.2222em', ';': '0.2778em', ' ': '0.25em', quad: '1em', qquad: '2em',
  enspace: '0.5em', thinspace: '0.1667em',
};

const ACCENTS: Record<string, string> = {
  hat: '^', widehat: '^', bar: '¯', overline: '‾', vec: '→', overrightarrow: '→', tilde: '~', widetilde: '~',
  dot: '˙', ddot: '¨', check: 'ˇ', breve: '˘',
};

const IGNORED = new Set([
  'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'bigl',
  'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr', 'left', 'right', 'nonumber', 'notag', '!',
]);

const DOUBLE_STRUCK: Record<string, string> = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ', P: 'ℙ', E: '𝔼' };

const ENV_FENCES: Record<string, [string, string]> = {
  cases: ['{', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'], matrix: ['', ''], aligned: ['', ''], align: ['', ''], 'align*': ['', ''],
  gathered: ['', ''], array: ['', ''], split: ['', ''],
};

type Node = ReactElement;
type Rows = Node[][][];

type Attrs = Record<string, string | CSSProperties | undefined>;

/* Children are always passed as varargs, so React needs no keys. */
function el(tag: string, attrs: Attrs | null, ...children: ReactNode[]): Node {
  return createElement(tag, attrs, ...children);
}
const row = (nodes: Node[]): Node => (nodes.length === 1 ? nodes[0] : el('mrow', null, ...nodes));
const mo = (v: string, attrs?: Attrs) => el('mo', attrs ?? null, v);

interface Based {
  node: Node;
  /** Scripts go above/below in display mode (\sum, \lim, \max…). */
  limits?: boolean;
  /** Named function (\log, \max…): followed by a thin space. */
  fn?: boolean;
}

class Parser {
  private i = 0;

  constructor(private toks: Tok[], private display: boolean) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private next(): Tok | undefined {
    return this.toks[this.i++];
  }

  parseAll(): Node {
    const rows = this.seq();
    if (this.i < this.toks.length) throw new TexError('Unexpected closing brace');
    return this.layout(rows, 'aligned');
  }

  /** Rows of cells until `}`, \end, \right or end of input. */
  private seq(): Rows {
    const rows: Rows = [[[]]];
    for (let tok = this.peek(); tok; tok = this.peek()) {
      if (tok.t === 'close') break;
      if (tok.t === 'cmd' && (tok.v === 'end' || tok.v === 'right')) break;
      if (tok.t === 'nl') { this.next(); rows.push([[]]); continue; }
      if (tok.t === 'amp') { this.next(); rows[rows.length - 1].push([]); continue; }
      const atom = this.atom();
      if (atom) {
        const r = rows[rows.length - 1];
        r[r.length - 1].push(atom);
      }
    }
    // Drop a trailing empty row left by a final `\\`.
    if (rows.length > 1 && rows[rows.length - 1].every((c) => c.length === 0)) rows.pop();
    return rows;
  }

  private layout(rows: Rows, env: string): Node {
    if (rows.length === 1 && rows[0].length === 1) return row(rows[0][0]);
    // MathML Core ignores `columnalign`, so alignment is CSS on each cell
    // (the attribute stays for engines that do honor it).
    const alignAt = (k: number): 'left' | 'right' | 'center' =>
      env === 'cases' ? 'left'
      : env.startsWith('align') || env === 'split' || env === 'aligned' ? (k % 2 ? 'left' : 'right')
      : 'center';
    const cols = Math.max(...rows.map((r) => r.length));
    return el(
      'mtable',
      { columnalign: Array.from({ length: cols }, (_, k) => alignAt(k)).join(' '), displaystyle: 'true' },
      ...rows.map((r) =>
        el(
          'mtr',
          null,
          ...r.map((cell, k) =>
            el(
              'mtd',
              { style: { textAlign: alignAt(k), padding: env === 'cases' ? (k > 0 ? '0.2em 0 0.2em 1em' : '0.2em 0') : '0.2em 0.4em' } },
              row(cell.length ? cell : [el('mrow', null)]),
            ),
          ),
        ),
      ),
    );
  }

  private atom(): Node | null {
    const based = this.base();
    if (!based) return null;
    let sub: Node | null = null;
    let sup: Node | null = null;
    let primes = '';
    for (let tok = this.peek(); tok; tok = this.peek()) {
      if (tok.t === 'sub') { this.next(); sub = this.arg(); }
      else if (tok.t === 'sup') { this.next(); sup = this.arg(); }
      else if (tok.t === 'char' && tok.v === "'") { this.next(); primes += '′'; }
      else break;
    }
    if (primes) sup = sup ? row([mo(primes), sup]) : mo(primes);
    let node = based.node;
    if (sub || sup) {
      const under = based.limits && this.display;
      if (sub && sup) node = el(under ? 'munderover' : 'msubsup', null, based.node, sub, sup);
      else if (sub) node = el(under ? 'munder' : 'msub', null, based.node, sub);
      else node = el(under ? 'mover' : 'msup', null, based.node, sup as Node);
    }
    // TeX puts a thin space after \log, \max…; MathML Core does not.
    return based.fn ? el('mrow', null, node, el('mspace', { width: '0.1667em' })) : node;
  }

  /** A script or command argument: a {group} or a single token. */
  private arg(): Node {
    const tok = this.peek();
    if (!tok) throw new TexError('Missing argument');
    if (tok.t === 'open') return this.group();
    const b = this.base();
    if (!b) throw new TexError('Missing argument');
    return b.node;
  }

  private group(): Node {
    const open = this.next();
    if (open?.t !== 'open') throw new TexError('Expected {');
    const rows = this.seq();
    if (this.next()?.t !== 'close') throw new TexError('Missing }');
    return this.layout(rows, 'matrix');
  }

  /** Raw word inside braces, e.g. the environment name in \begin{cases}. */
  private word(): string {
    if (this.next()?.t !== 'open') throw new TexError('Expected {');
    let w = '';
    for (let tok = this.next(); tok && tok.t !== 'close'; tok = this.next()) {
      if (tok.t === 'char' || tok.t === 'num') w += tok.v;
      else if (tok.t === 'cmd') w += tok.v;
    }
    return w;
  }

  private delimiter(): string {
    const tok = this.next();
    if (!tok) throw new TexError('Missing delimiter');
    if (tok.t === 'char') return tok.v === '.' ? '' : tok.v;
    if (tok.t === 'cmd') return OPS[tok.v] ?? (tok.v === '.' ? '' : tok.v);
    throw new TexError('Bad delimiter');
  }

  private base(): Based | null {
    const tok = this.peek();
    if (!tok) return null;
    switch (tok.t) {
      case 'open':
        return { node: this.group() };
      case 'num':
        this.next();
        return { node: el('mn', null, tok.v) };
      case 'text':
        this.next();
        return tok.cmd === 'operatorname'
          ? { node: el('mi', null, tok.v), limits: false, fn: true }
          : { node: el('mtext', null, tok.v.replace(/ /g, ' ')) };
      case 'char':
        this.next();
        return { node: this.charNode(tok.v) };
      case 'cmd':
        this.next();
        return this.command(tok.v);
      case 'sub':
      case 'sup': {
        // A script with no base, e.g. "{}^{n}" already handled; bare "^2" → empty base.
        return { node: el('mrow', null) };
      }
      default:
        this.next();
        return null;
    }
  }

  private charNode(c: string): Node {
    if (/[a-zA-Z]/.test(c)) return el('mi', null, c);
    if (c === '-') return mo('−');
    if (c === '*') return mo('∗');
    if (c === "'") return mo('′');
    if (c === '~') return el('mspace', { width: '0.25em' });
    if ('()[]|'.includes(c)) return mo(c, { stretchy: 'false' });
    return mo(c);
  }

  private command(name: string): Based | null {
    if (name in GREEK) return { node: el('mi', /[A-Z]/.test(name[0]) ? { mathvariant: 'normal' } : null, GREEK[name]) };
    if (name in IDENTS) return { node: el('mi', null, IDENTS[name]) };
    if (name in BIG_OPS) return { node: mo(BIG_OPS[name], { largeop: 'true', movablelimits: 'true' }), limits: !name.includes('int') };
    if (name in OPS) return { node: mo(OPS[name]) };
    if (FUNCS.has(name)) {
      const label = name === 'bmod' ? 'mod' : name;
      return { node: el('mi', null, label), limits: LIMIT_FUNCS.has(name), fn: true };
    }
    if (name in SPACES) return { node: el('mspace', { width: SPACES[name] }) };
    if (name in ACCENTS) {
      const body = this.arg();
      return { node: el('mover', { accent: 'true' }, body, mo(ACCENTS[name], { stretchy: name.startsWith('wide') || name.startsWith('over') ? 'true' : 'false' })) };
    }
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
      case 'cfrac': {
        const a = this.arg();
        const b = this.arg();
        return { node: el('mfrac', null, a, b) };
      }
      case 'binom':
      case 'dbinom':
      case 'tbinom': {
        const a = this.arg();
        const b = this.arg();
        return { node: el('mrow', null, mo('('), el('mfrac', { linethickness: '0' }, a, b), mo(')')) };
      }
      case 'sqrt': {
        const tok = this.peek();
        if (tok?.t === 'char' && tok.v === '[') {
          this.next();
          const idx: Node[] = [];
          for (let t = this.peek(); t && !(t.t === 'char' && t.v === ']'); t = this.peek()) {
            const a = this.atom();
            if (a) idx.push(a);
          }
          if (!this.peek()) throw new TexError('Missing ] in \\sqrt');
          this.next();
          const body = this.arg();
          return { node: el('mroot', null, body, row(idx)) };
        }
        return { node: el('msqrt', null, this.arg()) };
      }
      case 'left': {
        const open = this.delimiter();
        const rows = this.seq();
        const end = this.next();
        if (!(end?.t === 'cmd' && end.v === 'right')) throw new TexError('\\left without \\right');
        const close = this.delimiter();
        return {
          node: el(
            'mrow',
            null,
            ...(open ? [mo(open, { fence: 'true', stretchy: 'true' })] : []),
            this.layout(rows, 'matrix'),
            ...(close ? [mo(close, { fence: 'true', stretchy: 'true' })] : []),
          ),
        };
      }
      case 'begin': {
        const env = this.word();
        if (env === 'array') this.word(); // column spec — ignored
        const rows = this.seq();
        const end = this.next();
        if (!(end?.t === 'cmd' && end.v === 'end')) throw new TexError(`Missing \\end{${env}}`);
        this.word();
        const [l, r] = ENV_FENCES[env] ?? ['', ''];
        const table = this.layout(rows, env);
        return {
          node: el(
            'mrow',
            null,
            ...(l ? [mo(l, { fence: 'true', stretchy: 'true' })] : []),
            table,
            ...(r ? [mo(r, { fence: 'true', stretchy: 'true' })] : []),
          ),
        };
      }
      case 'mathbb': {
        const [a, b, c] = [this.peek(), this.toks[this.i + 1], this.toks[this.i + 2]];
        if (a?.t === 'open' && b?.t === 'char' && c?.t === 'close') {
          this.i += 3;
          return { node: el('mi', { mathvariant: 'normal' }, DOUBLE_STRUCK[b.v] ?? b.v) };
        }
        return { node: this.arg() };
      }
      case 'mathbf':
      case 'boldsymbol':
      case 'bm':
        return { node: el('mrow', { style: { fontWeight: 700 } }, this.arg()) };
      case 'mathrm':
      case 'mathsf':
      case 'mathtt':
      case 'mathit':
      case 'mathcal':
      case 'mathfrak':
      case 'mathscr': {
        const body = this.arg();
        return { node: name === 'mathrm' ? el('mrow', { mathvariant: 'normal' }, body) : body };
      }
      case 'underbrace':
      case 'overbrace': {
        const body = this.arg();
        const brace = mo(name === 'underbrace' ? '⏟' : '⏞', { stretchy: 'true' });
        return { node: el(name === 'underbrace' ? 'munder' : 'mover', null, body, brace), limits: true };
      }
      case 'pmod': {
        const body = this.arg();
        return { node: el('mrow', null, el('mspace', { width: '0.5em' }), mo('('), el('mi', null, 'mod'), el('mspace', { width: '0.25em' }), body, mo(')')) };
      }
      case 'not': {
        const b = this.base();
        return b ? { node: el('mrow', null, b.node, mo('̸')) } : null;
      }
      default:
        if (IGNORED.has(name)) return null;
        // Unknown command: show its name upright rather than failing.
        return { node: el('mi', { mathvariant: 'normal' }, `\\${name}`) };
    }
  }
}

/** Parse TeX into the contents of a <math> element. Throws TexError. */
export function texToMathML(tex: string, display = true): Node {
  return new Parser(lex(tex), display).parseAll();
}
