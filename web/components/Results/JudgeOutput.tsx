'use client';

import { linkErrorLines } from '@/lib/client/languages';
import s from './Results.module.css';

interface JudgeOutputProps {
  text: string;
  tone?: 'err' | 'info' | 'warn' | 'muted';
  /** Jump to a line of the learner's code (compile errors, tracebacks). */
  onLine?: (line: number, column?: number) => void;
  label?: string;
}

/**
 * Compiler / runtime output. References to the learner's own lines
 * ("solution.cpp:4:14", `File "solution.py", line 3`) become buttons that
 * put the cursor there.
 */
export function JudgeOutput({ text, tone = 'err', onLine, label = 'Judge output' }: JudgeOutputProps) {
  const segments = onLine ? linkErrorLines(text) : [{ text }];
  return (
    <pre className={s.output} data-tone={tone} aria-label={label} tabIndex={0}>
      {segments.map((seg, i) =>
        seg.line && onLine ? (
          <button
            key={i}
            type="button"
            className={`${s.lineRef} focus-ring`}
            onClick={() => onLine(seg.line!, seg.column)}
            title={`Go to line ${seg.line}${seg.column ? `, column ${seg.column}` : ''}`}
          >
            {seg.text}
          </button>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </pre>
  );
}
