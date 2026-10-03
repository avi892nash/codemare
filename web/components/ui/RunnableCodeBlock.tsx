'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';
import { LangMark } from './LangMark';
import { Spinner } from './Spinner';
import { StatusPill, STATUS_META, type StatusCode } from './StatusPill';
import { useModKey, useTouchOnly } from '@/components/Workspace/useModKey';
import { fmtTime } from './formatters';
import { highlight, LANGUAGE_LABEL, normalizeLanguage } from './highlight';
import s from './RunnableCodeBlock.module.css';

/** What a `run` implementation resolves with. Every field is optional. */
export interface RunResult {
  /** Verdict-style status; defaults to RE when `error`/`stderr`-only, else OK. */
  status?: StatusCode;
  stdout?: string;
  stderr?: string;
  /** CPU time in milliseconds (fractions allowed). */
  runtimeMs?: number;
  /** Peak memory in KB. */
  memoryKb?: number;
  compileMs?: number;
  /** Compiler / runtime / transport error message. */
  error?: string;
}

/** Executes the (possibly edited) code with stdin. Wire to /api/run later. */
export type RunCode = (code: string, stdin: string) => Promise<RunResult>;

export interface RunnableCodeBlockProps {
  code: string;
  language: string;
  run: RunCode;
  filename?: string;
  /** true → empty stdin box; a string pre-fills it; omit for no stdin. */
  stdin?: string | boolean;
  /** Let the learner edit the snippet (default true). */
  editable?: boolean;
  runLabel?: string;
  className?: string;
  style?: CSSProperties;
}

type Phase = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; result: RunResult };

function inferStatus(r: RunResult): StatusCode {
  if (r.status) return r.status;
  if (r.error) return 'RE';
  return 'OK';
}

const kb = (n: number) => `${Math.round(n).toLocaleString('en-US')}`;

/**
 * Code + Run for lessons (```lang run``` blocks). Editable with live
 * highlighting, optional stdin, and an output panel with verdict, runtime (ms)
 * and memory (KB). ⌘/Ctrl+Enter runs from anywhere inside the block. The
 * result is announced politely to screen readers.
 */
export function RunnableCodeBlock({
  code, language, run, filename, stdin, editable = true, runLabel = 'Run', className, style,
}: RunnableCodeBlockProps) {
  const [src, setSrc] = useState(code);
  const [input, setInput] = useState(typeof stdin === 'string' ? stdin : '');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const modKey = useModKey();
  const touch = useTouchOnly();
  const runSeq = useRef(0);
  const stdinId = useId();
  const lang = normalizeLanguage(language);
  const langLabel = lang ? LANGUAGE_LABEL[lang] : language;
  const edited = src !== code;

  // A new snippet (e.g. navigating between lessons) replaces any edits.
  useEffect(() => {
    setSrc(code);
    setPhase({ kind: 'idle' });
  }, [code]);

  const onRun = async () => {
    if (phase.kind === 'running') return;
    const seq = ++runSeq.current;
    setPhase({ kind: 'running' });
    let result: RunResult;
    try {
      result = await run(src, input);
    } catch (err) {
      result = { status: 'XX', error: err instanceof Error ? err.message : String(err) };
    }
    if (seq === runSeq.current) setPhase({ kind: 'done', result });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onRun();
    }
  };

  const result = phase.kind === 'done' ? phase.result : null;
  const status = result ? inferStatus(result) : null;
  const announce =
    phase.kind === 'running'
      ? 'Running…'
      : result && status
        ? `Run finished: ${STATUS_META[status].long}${result.runtimeMs != null ? `, ${fmtTime(result.runtimeMs).join(' ')}` : ''}${result.memoryKb != null ? `, ${kb(result.memoryKb)} KB` : ''}.`
        : '';

  return (
    <div className={[s.block, className].filter(Boolean).join(' ')} style={style} onKeyDown={onKeyDown}>
      <div className={s.header}>
        {lang && <LangMark lang={lang} />}
        {filename && <span className={`${s.title} mono`}>{filename}</span>}
        {langLabel && <span className={s.langLabel}>{filename ? `· ${langLabel}` : langLabel}</span>}
        <span className={s.spacer} />
        {edited && (
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => setSrc(code)} className={s.headBtn}>
            Reset
          </Button>
        )}
        <CopyButton text={src} ariaLabel={filename ? `Copy ${filename}` : 'Copy code'} />
        {/* Neutral, not primary: a lesson's one primary action is "Mark complete". */}
        <Button
          size="sm"
          icon="play"
          loading={phase.kind === 'running'}
          kbd={touch ? undefined : `${modKey}↵`}
          onClick={() => void onRun()}
          className={s.headBtn}
        >
          {runLabel}
        </Button>
      </div>

      {editable ? (
        <Editor value={src} onChange={setSrc} language={language} label={`${filename ?? langLabel ?? 'Code'} editor`} />
      ) : (
        <CodeBlock code={src} language={language} style={{ border: 'none', borderRadius: 0 }} />
      )}

      {stdin !== undefined && stdin !== false && (
        <div className={`${s.section} ${s.stdinWrap}`}>
          <div className={s.sectionHead}>
            <label htmlFor={stdinId} className={s.sectionLabel}>Input (stdin)</label>
          </div>
          <textarea
            id={stdinId}
            className={s.stdin}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            rows={2}
            placeholder="Lines passed to the program's standard input"
          />
        </div>
      )}

      {phase.kind !== 'idle' && (
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionLabel}>Output</span>
            {phase.kind === 'running' ? (
              <span className={s.running}>
                <Spinner size={12} /> Running…
              </span>
            ) : (
              status && <StatusPill code={status} showLong withIcon size="xs" />
            )}
            {result && (
              <span className={`${s.metrics} mono`}>
                {result.runtimeMs != null && (
                  <span className={s.metric} title="CPU time">
                    <Icon name="zap" size={12} />
                    {fmtTime(result.runtimeMs)[0]}
                    <span className={s.unit}>{fmtTime(result.runtimeMs)[1]}</span>
                  </span>
                )}
                {result.memoryKb != null && (
                  <span className={s.metric} title="Peak memory">
                    <Icon name="memory" size={12} />
                    {kb(result.memoryKb)}
                    <span className={s.unit}>KB</span>
                  </span>
                )}
                {result.compileMs != null && (
                  <span className={s.metric} title="Compile time">
                    <Icon name="cpu" size={12} />
                    {fmtTime(result.compileMs)[0]}
                    <span className={s.unit}>{fmtTime(result.compileMs)[1]}</span>
                  </span>
                )}
              </span>
            )}
          </div>
          {result && (
            <pre className={`${s.output} scroll`} tabIndex={0} aria-label="Program output">
              {result.stdout ? <span>{result.stdout}</span> : null}
              {result.stderr ? <span className={s.stderr}>{result.stdout ? '\n' : ''}{result.stderr}</span> : null}
              {result.error ? <span className={s.stderr}>{result.stdout || result.stderr ? '\n' : ''}{result.error}</span> : null}
              {!result.stdout && !result.stderr && !result.error && <span className={s.muted}>(no output)</span>}
            </pre>
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}

/**
 * Minimal code editor: a transparent <textarea> over the highlighted <pre>.
 * Native text editing, selection, undo and IME; Tab keeps moving focus
 * (keyboard users are never trapped).
 */
function Editor({
  value, onChange, language, label,
}: { value: string; onChange: (v: string) => void; language: string; label: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const lines = highlight(value, language);
  const shown = value.endsWith('\n') ? [...lines, []] : lines;
  return (
    <div className={s.editor}>
      <div className={`${s.gutter} mono`} aria-hidden="true">
        {shown.map((_, i) => (
          <div key={i} className="gutter-num">{i + 1}</div>
        ))}
      </div>
      <div className={s.surface}>
        <pre ref={preRef} className={`${s.pre} mono`} aria-hidden="true">
          {shown.map((ln, i) => (
            <div key={i}>
              {ln.length === 0 ? ' ' : ln.map(([cls, t], j) => <span key={j} className={cls}>{t}</span>)}
            </div>
          ))}
        </pre>
        <textarea
          className={`${s.textarea} mono`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (preRef.current) preRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
          aria-label={label}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
        />
      </div>
    </div>
  );
}
