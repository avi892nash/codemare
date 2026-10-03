import type { CSSProperties, ReactNode } from 'react';
import { CopyButton } from './CopyButton';
import { LangMark } from './LangMark';
import { highlight, LANGUAGE_LABEL, normalizeLanguage, type CodeToken } from './highlight';

/**
 * Token classes (.tk-kw, .tk-fn, …) are defined in app/globals.css and
 * themed through --tk-* variables. Server-safe: highlighting runs wherever
 * the block renders (on the server for RSC pages — no highlighter JS shipped);
 * only the Copy button hydrates.
 *
 * Accepts `code` (auto-highlighted when `language` is one of python,
 * javascript, typescript, cpp, java, go — or an alias like py/js/ts/c++) or
 * pre-tokenized `tokens` for hand-made highlighting.
 */
export type { CodeToken };
export type CodeLine = CodeToken[] | string;

export interface CodeBlockProps {
  /** Source text. */
  code?: string;
  /** Pre-tokenized lines (skips the highlighter). */
  tokens?: CodeLine[];
  /** Language id or alias; drives highlighting and the header badge. */
  language?: string;
  /** Shown in the header, e.g. "two_sum.py". */
  filename?: string;
  /** Legacy header label; prefer `filename`. */
  badge?: string;
  /** Copy-to-clipboard button in the header. */
  copy?: boolean;
  showGutter?: boolean;
  /** Set false to render `code` as plain text. */
  highlight?: boolean;
  /** 1-based line numbers to emphasize. */
  highlightLines?: number[];
  startLine?: number;
  maxHeight?: number | string;
  /** Extra header content at the right (before Copy). */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function flatten(lines: CodeLine[]): string {
  return lines.map((ln) => (typeof ln === 'string' ? ln : ln.map((t) => t[1]).join(''))).join('\n');
}

export function CodeBlock({
  code, tokens, language, filename, badge, copy = false, showGutter = true, highlight: doHighlight = true,
  highlightLines, startLine = 1, maxHeight, actions, className = '', style,
}: CodeBlockProps) {
  const lang = normalizeLanguage(language);
  const lines: CodeLine[] =
    tokens ?? (doHighlight ? highlight(code ?? '', lang) : (code ?? '').replace(/\n$/, '').split('\n'));
  const text = code ?? flatten(lines);
  const title = filename ?? badge;
  const langLabel = lang ? LANGUAGE_LABEL[lang] : language;
  const marked = new Set(highlightLines);
  const showHeader = !!(title || langLabel || copy || actions);

  return (
    <div
      className={`card-2 ${className}`.trim()}
      style={{ borderRadius: 'var(--r)', overflow: 'hidden', ...style }}
    >
      {showHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 30,
            padding: '4px 8px 4px 10px',
            background: 'var(--bg-3)',
            borderBottom: '1px solid var(--line-2)',
          }}
        >
          {lang && <LangMark lang={lang} size={13} />}
          {title && (
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
          )}
          {langLabel && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', whiteSpace: 'nowrap' }}>
              {title ? `· ${langLabel}` : langLabel}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {actions}
          {copy && <CopyButton text={text} ariaLabel={title ? `Copy ${title}` : 'Copy code'} />}
        </div>
      )}
      <pre
        className="mono scroll"
        tabIndex={0}
        style={{
          margin: 0,
          padding: '12px 0',
          background: 'var(--bg-2)',
          fontSize: 'var(--fs-sm)',
          lineHeight: 1.55,
          overflow: 'auto',
          maxHeight,
          outlineOffset: -2,
        }}
      >
        <code style={{ display: 'block', minWidth: 'max-content', fontFamily: 'inherit' }}>
          {lines.map((ln, i) => {
            const n = i + startLine;
            const hot = marked.has(n);
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  background: hot ? 'var(--accent-bg)' : undefined,
                  boxShadow: hot ? 'inset 2px 0 0 var(--accent)' : undefined,
                }}
              >
                {showGutter && <span className="mono gutter-num" aria-hidden="true">{n}</span>}
                <span style={{ paddingLeft: showGutter ? 0 : 14, paddingRight: 14, whiteSpace: 'pre' }}>
                  {typeof ln === 'string'
                    ? <span className="tk-pa">{ln || ' '}</span>
                    : ln.length === 0
                      ? ' '
                      : ln.map(([cls, t], j) => <span key={j} className={cls}>{t}</span>)}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
