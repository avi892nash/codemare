'use client';

import { useState } from 'react';
import { Icon } from './Icon';

/**
 * Token classes (.tk-kw, .tk-fn, …) are defined in index.css. The block can
 * accept either a flat string (renders monospace, no highlighting) or an array
 * of [tokenClass, text] tuples for a hand-tokenized look matching the design.
 *
 * Renders with optional gutter line numbers and a copy button.
 */
export type CodeToken = [tokenClass: string, text: string];
export type CodeLine = CodeToken[] | string;

interface CodeBlockProps {
  /** Single string of code (no syntax tokens). */
  code?: string;
  /** Pre-tokenized lines for the design's static highlighter. */
  tokens?: CodeLine[];
  language?: string;
  badge?: string;
  copy?: boolean;
  showGutter?: boolean;
  className?: string;
}

export function CodeBlock({
  code, tokens, language, badge, copy = false, showGutter = true, className = '',
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines: CodeLine[] = tokens ?? (code ?? '').split('\n').map((s) => [['tk-pa', s]] as CodeToken[]);

  const onCopy = async () => {
    try {
      const flat = lines.map((ln) => (typeof ln === 'string' ? ln : ln.map((t) => t[1]).join(''))).join('\n');
      await navigator.clipboard.writeText(flat);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  };

  return (
    <div className={`card-2 ${className}`} style={{ borderRadius: 'var(--r)', overflow: 'hidden' }}>
      {(badge || copy) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 10px',
            background: 'var(--bg-3)',
            borderBottom: '1px solid var(--line-2)',
          }}
        >
          {badge && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
              {badge}
            </span>
          )}
          {language && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginLeft: 8 }}>
              · {language}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {copy && (
            <button
              onClick={onCopy}
              className="focus-ring"
              title="Copy"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--fg-2)',
                cursor: 'pointer',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px',
                borderRadius: 4,
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size={12} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      )}
      <pre
        className="mono"
        style={{
          margin: 0,
          padding: '12px 0',
          background: 'var(--bg-2)',
          fontSize: 12.5,
          lineHeight: 1.55,
          overflowX: 'auto',
        }}
      >
        {lines.map((ln, i) => (
          <div key={i} style={{ display: 'flex' }}>
            {showGutter && <span className="mono gutter-num">{i + 1}</span>}
            <span style={{ paddingRight: 14, whiteSpace: 'pre' }}>
              {typeof ln === 'string'
                ? <span className="tk-pa">{ln || ' '}</span>
                : (ln.length === 0
                    ? ' '
                    : ln.map(([cls, text], j) => <span key={j} className={cls}>{text}</span>))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
