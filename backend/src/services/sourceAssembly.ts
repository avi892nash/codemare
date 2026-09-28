/**
 * Prelude assembly: dependency sources (a learner's earlier components, same
 * language) placed before the learner's code.
 *
 *   python / javascript / typescript / cpp — concatenated in order;
 *   go   — package clauses stripped, every piece's imports hoisted into one
 *          deduplicated block (see assembleGo);
 *   java — unsupported: the harness needs a single `class Solution`, which
 *          dependency functions can't be concatenated into (spec §0.4). The
 *          request validator rejects it; wrapFunctionCode throws as a guard.
 *
 * Line numbers: C++ and Go get compiler line directives so errors (and Go
 * panics) point at `solution.cpp:3` / `solution.go:3` — the learner's own
 * line — rather than a line of the generated file. For the others the joined
 * text carries a segment table that callers can use to map a line back.
 */

export interface SourceSegment {
  /** File-like name used in messages, e.g. "solution.ts" or "prelude_1.ts". */
  name: string;
  /** 1-based line of the segment's first line in the joined source. */
  startLine: number;
  lineCount: number;
}

export interface JoinedSource {
  source: string;
  segments: SourceSegment[];
}

export type ConcatLanguage = 'python' | 'javascript' | 'typescript' | 'cpp';

const EXTENSION: Record<ConcatLanguage, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  cpp: 'cpp',
};

function countLines(text: string): number {
  if (text === '') return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  // A trailing newline doesn't start a new (visible) line.
  return text.endsWith('\n') ? n - 1 : n;
}

function withNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Join prelude pieces and the learner's code. With no prelude the code is
 * returned unchanged (C++ aside, which always gets its `#line` marker).
 */
export function joinSources(
  language: ConcatLanguage,
  prelude: readonly string[],
  code: string
): JoinedSource {
  const ext = EXTENSION[language];
  const pieces = [
    ...prelude.map((text, k) => ({ name: `prelude_${k + 1}.${ext}`, text })),
    { name: `solution.${ext}`, text: code },
  ];

  if (language !== 'cpp' && prelude.length === 0) {
    return { source: code, segments: [{ name: pieces[0].name, startLine: 1, lineCount: countLines(code) }] };
  }

  let source = '';
  let line = 1;
  const segments: SourceSegment[] = [];
  pieces.forEach((piece, k) => {
    const last = k === pieces.length - 1;
    if (language === 'cpp') {
      source += `#line 1 "${piece.name}"\n`;
      line += 1;
    }
    const text = last ? piece.text : withNewline(piece.text);
    segments.push({ name: piece.name, startLine: line, lineCount: countLines(piece.text) });
    source += text;
    if (!last) {
      // A blank line between pieces (python needs it after an indented block).
      source += '\n';
      line += countLines(piece.text) + 1;
    }
  });
  return { source, segments };
}

/** Map a 1-based line of a joined source back to (segment name, line). */
export function locateLine(
  segments: readonly SourceSegment[],
  line: number
): { name: string; line: number } | undefined {
  for (const s of segments) {
    if (line >= s.startLine && line < s.startLine + s.lineCount) {
      return { name: s.name, line: line - s.startLine + 1 };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------------- *
 * Go
 * ------------------------------------------------------------------------- */

export interface GoImportSpec {
  /** Explicit package name: an identifier, "." or "_". */
  name?: string;
  /** Import path, unquoted. */
  path: string;
  /** The path literal as written ("..." or `...`). */
  literal: string;
  /** Offset of the spec (its name, or else its path) in the parsed source. */
  offset: number;
}

/** A hoisted import plus where it came from, for its //line directive. */
export interface GoMergedImport extends GoImportSpec {
  file: string;
  line: number;
  col: number;
}

export interface GoHeader {
  imports: GoImportSpec[];
  /** Offset where the declarations after the package clause and imports begin. */
  bodyOffset: number;
}

const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_PART = /[A-Za-z0-9_\u0080-\uffff]/;

function unquoteGoString(literal: string): string {
  if (literal.startsWith('`')) return literal.slice(1, -1);
  return literal
    .slice(1, -1)
    .replace(/\\(["\\/abfnrtv])/g, (_m, c: string) => (c === '"' || c === '\\' || c === '/' ? c : ''));
}

/**
 * Parse the header of a Go source file — optional package clause, then any
 * number of import declarations (single or grouped, with comments, named /
 * dot / blank imports, interpreted or raw path literals) — the same prefix
 * the Go grammar allows before other declarations. Parsing stops at the
 * first token that isn't `import`; a malformed import declaration is left in
 * the body so the Go compiler reports it at its real line.
 */
export function parseGoHeader(src: string): GoHeader {
  let pos = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = src.length;

  const skipTrivia = (): void => {
    while (pos < n) {
      const c = src[pos];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        pos++;
      } else if (c === '/' && src[pos + 1] === '/') {
        const nl = src.indexOf('\n', pos);
        pos = nl < 0 ? n : nl + 1;
      } else if (c === '/' && src[pos + 1] === '*') {
        const end = src.indexOf('*/', pos + 2);
        pos = end < 0 ? n : end + 2;
      } else {
        return;
      }
    }
  };
  const keywordAt = (word: string): boolean =>
    src.startsWith(word, pos) && !IDENT_PART.test(src[pos + word.length] ?? '');
  const readIdent = (): string | undefined => {
    if (pos >= n || !IDENT_START.test(src[pos])) return undefined;
    const start = pos;
    while (pos < n && IDENT_PART.test(src[pos])) pos++;
    return src.slice(start, pos);
  };
  const readPath = (): string | undefined => {
    const q = src[pos];
    if (q === '`') {
      const end = src.indexOf('`', pos + 1);
      if (end < 0) return undefined;
      const lit = src.slice(pos, end + 1);
      pos = end + 1;
      return lit;
    }
    if (q !== '"') return undefined;
    let i = pos + 1;
    while (i < n && src[i] !== '"' && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
    if (src[i] !== '"') return undefined;
    const lit = src.slice(pos, i + 1);
    pos = i + 1;
    return lit;
  };
  const readSpec = (): GoImportSpec | undefined => {
    const offset = pos;
    let name: string | undefined;
    if (src[pos] === '.') {
      name = '.';
      pos++;
      skipTrivia();
    } else if (src[pos] !== '"' && src[pos] !== '`') {
      name = readIdent();
      if (name === undefined) return undefined;
      skipTrivia();
    }
    const literal = readPath();
    if (literal === undefined) return undefined;
    return { name, path: unquoteGoString(literal), literal, offset };
  };
  /** An optional `;` on the same line ends a declaration. */
  const skipSemicolon = (): void => {
    let i = pos;
    while (src[i] === ' ' || src[i] === '\t') i++;
    if (src[i] === ';') pos = i + 1;
  };

  skipTrivia();
  let bodyOffset = pos;
  if (keywordAt('package')) {
    pos += 'package'.length;
    skipTrivia();
    if (readIdent() === undefined) return { imports: [], bodyOffset };
    skipSemicolon();
    bodyOffset = pos;
  }

  const imports: GoImportSpec[] = [];
  for (;;) {
    skipTrivia();
    if (!keywordAt('import')) break;
    pos += 'import'.length;
    skipTrivia();
    const specs: GoImportSpec[] = [];
    if (src[pos] === '(') {
      pos++;
      let closed = false;
      while (pos < n) {
        skipTrivia();
        if (src[pos] === ')') {
          pos++;
          closed = true;
          break;
        }
        const spec = readSpec();
        if (!spec) break;
        specs.push(spec);
        skipSemicolon();
      }
      if (!closed) break;
    } else {
      const spec = readSpec();
      if (!spec) break;
      specs.push(spec);
    }
    skipSemicolon();
    imports.push(...specs);
    bodyOffset = pos;
  }
  return { imports, bodyOffset };
}

export interface GoUnit {
  /** Deduplicated imports of every piece (first spelling wins). */
  imports: GoMergedImport[];
  /** Declarations of every piece, each introduced by a //line directive. */
  body: string;
}

/** 1-based line and column of `offset` in `text`. */
function position(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const lastNl = before.lastIndexOf('\n');
  return { line: before.split('\n').length, col: offset - lastNl };
}

/**
 * Merge prelude pieces and the learner's code into one Go compilation unit
 * (minus the package clause, which the harness supplies).
 */
export function assembleGo(prelude: readonly string[], code: string): GoUnit {
  const pieces = [
    ...prelude.map((text, k) => ({ name: `prelude_${k + 1}.go`, text })),
    { name: 'solution.go', text: code },
  ];
  const imports: GoMergedImport[] = [];
  const seen = new Set<string>();
  let body = '';
  for (const piece of pieces) {
    const header = parseGoHeader(piece.text);
    for (const spec of header.imports) {
      const key = `${spec.name ?? ''} ${spec.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        imports.push({ ...spec, file: piece.name, ...position(piece.text, spec.offset) });
      }
    }
    // Line of the first body character in the original text.
    let { line } = position(piece.text, header.bodyOffset);
    let rest = piece.text.slice(header.bodyOffset);
    const eol = rest.indexOf('\n');
    const lineRemainder = eol < 0 ? rest : rest.slice(0, eol);
    if (eol >= 0 && lineRemainder.trim() === '') {
      // The header ended at the end of a line: start with the next one.
      rest = rest.slice(eol + 1);
      line += 1;
    }
    body += `//line ${piece.name}:${line}:1\n${withNewline(rest)}`;
  }
  return { imports, body };
}

/**
 * Render hoisted imports as one grouped declaration ('' when there are none).
 * Each spec gets a //line directive with its original file:line:col, so an
 * "imported and not used" error names the learner's own line.
 */
export function renderGoImports(imports: readonly GoMergedImport[]): string {
  if (imports.length === 0) return '';
  const lines = imports.map(
    (s) => `//line ${s.file}:${s.line}:${s.col}\n${s.name ? `${s.name} ` : ''}${s.literal}`
  );
  return `import (\n${lines.join('\n')}\n)\n`;
}
