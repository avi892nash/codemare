'use client';

import { useMemo, type ReactNode } from 'react';
import { highlight } from '@/components/ui/highlight';
import s from './author.module.css';

export interface CodeFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Highlighting language (python, cpp, …). */
  language: string;
  /** Accessible name of the textarea. */
  label: string;
  /** Header row content (language mark, actions). Omit for a bare editor. */
  header?: ReactNode;
  minLines?: number;
  maxHeight?: number;
  invalid?: boolean;
  describedBy?: string;
  placeholder?: string;
}

/**
 * Syntax-highlighted code editor: a transparent <textarea> over the
 * highlighted <pre> (the UI kit's RunnableCodeBlock technique), sized to its
 * content inside one scroll box. Native editing, undo, selection and IME;
 * Tab moves focus, so keyboard users are never trapped.
 */
export function CodeField({
  id, value, onChange, language, label, header, minLines = 6, maxHeight = 460, invalid, describedBy, placeholder,
}: CodeFieldProps) {
  const lines = useMemo(() => {
    const hl = highlight(value, language);
    return value.endsWith('\n') ? [...hl, []] : hl;
  }, [value, language]);
  const real = Math.max(1, lines.length);
  const padded = Math.max(real, minLines);

  return (
    <div className={s.code} data-invalid={invalid || undefined}>
      {header && <div className={s.codeHead}>{header}</div>}
      <div className={`${s.codeScroll} scroll`} style={{ maxHeight }}>
        <div className={s.editor}>
          <div className={`${s.gutter} mono`} aria-hidden="true">
            {Array.from({ length: padded }, (_, i) => (
              <div key={i} className="gutter-num">{i < real ? i + 1 : ' '}</div>
            ))}
          </div>
          <div className={s.surface}>
            <pre className={`${s.pre} mono`} aria-hidden="true">
              {Array.from({ length: padded }, (_, i) => {
                const ln = lines[i];
                return (
                  <div key={i}>
                    {!ln || ln.length === 0 ? ' ' : ln.map(([cls, t], j) => <span key={j} className={cls}>{t}</span>)}
                  </div>
                );
              })}
            </pre>
            <textarea
              id={id}
              className={`${s.textarea} mono`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-label={label}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              placeholder={placeholder}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              wrap="off"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
