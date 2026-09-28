/**
 * Tiny, dependency-free syntax highlighter for the six judge languages.
 * Produces the design's `[tokenClass, text]` tuples (`tk-kw` keyword, `tk-fn`
 * function, `tk-ty` type/class, `tk-st` string, `tk-nu` number/constant,
 * `tk-co` comment, `tk-op` operator/punctuation, `tk-pa` plain) split into
 * lines. Regex-based, not a parser: good enough for lessons and snippets,
 * and cheap enough to run on the server so lesson pages ship no highlighter.
 */

export type CodeToken = [tokenClass: string, text: string];
export type CodeLanguage = 'python' | 'javascript' | 'typescript' | 'cpp' | 'java' | 'go';

export const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  cpp: 'C++',
  java: 'Java',
  go: 'Go',
};

const ALIASES: Record<string, CodeLanguage> = {
  python: 'python', py: 'python', python3: 'python',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', node: 'javascript',
  typescript: 'typescript', ts: 'typescript', tsx: 'typescript',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', c: 'cpp',
  java: 'java',
  go: 'go', golang: 'go',
};

/** "py", "C++", "golang"… → a CodeLanguage, or null when unknown. */
export function normalizeLanguage(lang: string | null | undefined): CodeLanguage | null {
  if (!lang) return null;
  return ALIASES[lang.trim().toLowerCase()] ?? null;
}

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

interface LangSpec {
  keywords: Set<string>;
  types: Set<string>;
  constants: Set<string>;
  lineComment: string;
  blockComment: boolean;
  strings: RegExp[];
  /** Capitalized identifiers read as types/classes. */
  capitalTypes: boolean;
  /** Extra leading rules (preprocessor, decorators…). */
  extra?: Array<[RegExp, string]>;
}

const DQ = /"(?:[^"\\\n]|\\.)*"?/y;
const SQ = /'(?:[^'\\\n]|\\.)*'?/y;

const JS_KW =
  'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield';
const TS_KW = `${JS_KW} abstract as declare enum implements interface is keyof namespace private protected public readonly satisfies type infer override`;

const SPECS: Record<CodeLanguage, LangSpec> = {
  python: {
    keywords: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'),
    types: words('int str float bool list dict set tuple bytes object complex frozenset type range'),
    constants: words('True False None'),
    lineComment: '#',
    blockComment: false,
    strings: [
      /(?:[rRbBuUfF]{1,2})?"""[\s\S]*?(?:"""|$)/y,
      /(?:[rRbBuUfF]{1,2})?'''[\s\S]*?(?:'''|$)/y,
      /(?:[rRbBuUfF]{1,2})?"(?:[^"\\\n]|\\.)*"?/y,
      /(?:[rRbBuUfF]{1,2})?'(?:[^'\\\n]|\\.)*'?/y,
    ],
    capitalTypes: true,
    extra: [[/@[A-Za-z_][\w.]*/y, 'tk-fn']],
  },
  javascript: {
    keywords: words(JS_KW),
    types: words(''),
    constants: words('true false null undefined NaN Infinity'),
    lineComment: '//',
    blockComment: true,
    strings: [/`(?:[^`\\]|\\[\s\S])*`?/y, DQ, SQ],
    capitalTypes: true,
  },
  typescript: {
    keywords: words(TS_KW),
    types: words('number string boolean void any unknown never bigint symbol object'),
    constants: words('true false null undefined NaN Infinity'),
    lineComment: '//',
    blockComment: true,
    strings: [/`(?:[^`\\]|\\[\s\S])*`?/y, DQ, SQ],
    capitalTypes: true,
    extra: [[/@[A-Za-z_][\w.]*/y, 'tk-fn']],
  },
  cpp: {
    keywords: words('alignas alignof auto break case catch class const constexpr const_cast continue decltype default delete do dynamic_cast else enum explicit export extern for friend goto if inline mutable namespace new noexcept operator override final private protected public register reinterpret_cast return sizeof static static_assert static_cast struct switch template this thread_local throw try typedef typeid typename union using virtual volatile while'),
    types: words('int long short char bool float double void unsigned signed size_t int64_t int32_t uint64_t uint32_t string vector map unordered_map set unordered_set pair queue stack deque priority_queue array bitset tuple std'),
    constants: words('true false nullptr NULL'),
    lineComment: '//',
    blockComment: true,
    strings: [/R"([^(\s]*)\([\s\S]*?\)\1"/y, DQ, SQ],
    capitalTypes: false,
    extra: [
      [/#\s*[A-Za-z_]\w*/y, 'tk-kw'],
      [/(?<=#\s*include\s*)<[^>\n]+>/y, 'tk-st'],
    ],
  },
  java: {
    keywords: words('abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public record return static strictfp super switch synchronized this throw throws transient try var volatile while yield sealed permits non-sealed'),
    types: words('int long short byte char boolean float double void'),
    constants: words('true false null'),
    lineComment: '//',
    blockComment: true,
    strings: [/"""[\s\S]*?(?:"""|$)/y, DQ, SQ],
    capitalTypes: true,
    extra: [[/@[A-Za-z_][\w.]*/y, 'tk-fn']],
  },
  go: {
    keywords: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
    types: words('bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any'),
    constants: words('true false nil iota'),
    lineComment: '//',
    blockComment: true,
    strings: [/`[^`]*`?/y, DQ, SQ],
    capitalTypes: false,
  },
};

const NUMBER = /(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.\d[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[a-zA-Z]*/y;
const IDENT = /[A-Za-z_$][\w$]*(?=(\s*\()?)/y;
const OPERATOR = /[+\-*/%=<>!&|^~?:]+|[()[\]{};,.]/y;
const SPACE = /\s+/y;

function classifyIdent(word: string, isCall: boolean, spec: LangSpec): string {
  if (spec.keywords.has(word)) return 'tk-kw';
  if (spec.constants.has(word)) return 'tk-nu';
  if (spec.types.has(word)) return 'tk-ty';
  if (isCall) return 'tk-fn';
  if (spec.capitalTypes && /^[A-Z][A-Za-z0-9_]*$/.test(word) && /[a-z]/.test(word)) return 'tk-ty';
  return 'tk-pa';
}

function tokenize(code: string, lang: CodeLanguage): CodeToken[] {
  const spec = SPECS[lang];
  const out: CodeToken[] = [];
  const push = (cls: string, text: string) => {
    const last = out[out.length - 1];
    if (last && last[0] === cls) last[1] += text;
    else out.push([cls, text]);
  };
  const lineComment = new RegExp(`${spec.lineComment.replace(/[/#]/g, '\\$&')}[^\\n]*`, 'y');
  const blockComment = /\/\*[\s\S]*?(?:\*\/|$)/y;
  const at = (re: RegExp, i: number) => {
    re.lastIndex = i;
    return re.exec(code);
  };

  let i = 0;
  while (i < code.length) {
    let m: RegExpExecArray | null;
    if ((m = at(SPACE, i))) { push('tk-pa', m[0]); i += m[0].length; continue; }
    if ((m = at(lineComment, i))) { push('tk-co', m[0]); i += m[0].length; continue; }
    if (spec.blockComment && (m = at(blockComment, i))) { push('tk-co', m[0]); i += m[0].length; continue; }
    let matched = false;
    for (const re of spec.strings) {
      if ((m = at(re, i)) && m[0].length > 0) { push('tk-st', m[0]); i += m[0].length; matched = true; break; }
    }
    if (matched) continue;
    for (const [re, cls] of spec.extra ?? []) {
      if ((m = at(re, i)) && m[0].length > 0) { push(cls, m[0]); i += m[0].length; matched = true; break; }
    }
    if (matched) continue;
    if (/\d/.test(code[i]) || (code[i] === '.' && /\d/.test(code[i + 1] ?? ''))) {
      if ((m = at(NUMBER, i)) && m[0].length > 0) { push('tk-nu', m[0]); i += m[0].length; continue; }
    }
    if ((m = at(IDENT, i))) {
      out.push([classifyIdent(m[0], m[1] !== undefined, spec), m[0]]);
      i += m[0].length;
      continue;
    }
    if ((m = at(OPERATOR, i))) { push('tk-op', m[0]); i += m[0].length; continue; }
    push('tk-pa', code[i]);
    i += 1;
  }
  return out;
}

/** Split a flat token stream into lines (tokens spanning newlines are cut). */
export function toLines(tokens: CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const [cls, text] of tokens) {
    const parts = text.split('\n');
    parts.forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1].push([cls, part]);
    });
  }
  return lines;
}

/**
 * Highlight `code` for `language` (any alias). Unknown languages come back
 * as plain lines. Trailing newline does not add an empty last line.
 */
export function highlight(code: string, language: string | null | undefined): CodeToken[][] {
  const src = code.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const lang = normalizeLanguage(language);
  if (!lang) return src.split('\n').map((l) => (l ? [['tk-pa', l] as CodeToken] : []));
  return toLines(tokenize(src, lang));
}
