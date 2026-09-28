'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from '@/components/ui/ThemeProvider';
import { LANGUAGE_META } from '@/lib/client/languages';
import type { Language, SupportedLanguage } from '@/lib/types';
import { buildMonacoTheme, readTokenColors, themeName } from './monacoTheme';
import s from './CodeEditor.module.css';

// Monaco is ~2 MB: loaded on the client only, after the page is interactive,
// with a code-shaped placeholder so the pane never collapses.
const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <EditorPlaceholder />,
});

/** Imperative handle for the pane around the editor. */
export interface CodeEditorHandle {
  focus(): void;
  /** Put the cursor on a 1-based line (and column) and scroll it into view. */
  revealLine(line: number, column?: number): void;
}

export interface EditorMarker {
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning';
}

interface CodeEditorProps {
  language: SupportedLanguage | Language;
  value: string;
  onChange: (next: string) => void;
  /** ⌘/Ctrl + Enter inside the editor. */
  onRun?: () => void;
  /** ⌘/Ctrl + Shift + Enter inside the editor. */
  onSubmit?: () => void;
  /** Squiggles, e.g. compile errors mapped to the learner's lines. */
  markers?: EditorMarker[];
  readOnly?: boolean;
  ariaLabel?: string;
  handleRef?: MutableRefObject<CodeEditorHandle | null>;
}

/**
 * Monaco, themed from the design tokens for both themes (and re-themed when
 * the theme toggles), in the six judge languages. The value is controlled.
 */
export function CodeEditor({
  language,
  value,
  onChange,
  onRun,
  onSubmit,
  markers,
  readOnly = false,
  ariaLabel = 'Code editor',
  handleRef,
}: CodeEditorProps) {
  const { theme } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef(onRun);
  const submitRef = useRef(onSubmit);
  runRef.current = onRun;
  submitRef.current = onSubmit;

  const applyTheme = useCallback(
    (monaco: Monaco) => {
      const scope = wrapRef.current ?? document.documentElement;
      monaco.editor.defineTheme(themeName(theme), buildMonacoTheme(theme, readTokenColors(scope)));
      monaco.editor.setTheme(themeName(theme));
    },
    [theme]
  );

  // The html class flips before React re-renders, so the tokens are current here.
  useEffect(() => {
    if (monacoRef.current) applyTheme(monacoRef.current);
  }, [applyTheme]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'judge',
      (markers ?? []).map((m) => ({
        startLineNumber: m.line,
        endLineNumber: m.line,
        startColumn: m.column ?? 1,
        endColumn: m.column ? m.column + 1 : model.getLineMaxColumn(Math.min(m.line, model.getLineCount())),
        message: m.message,
        severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
      }))
    );
  }, [markers, value]);

  const onMount: OnMount = (instance, monaco) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    applyTheme(monaco);
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current?.());
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => submitRef.current?.());
    // next/font exposes the family through a CSS variable; Monaco measures
    // glyphs itself, so hand it the resolved family and re-measure once loaded.
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    if (mono) instance.updateOptions({ fontFamily: `${mono}, ui-monospace, SFMono-Regular, Menlo, monospace` });
    void document.fonts?.ready.then(() => monaco.editor.remeasureFonts());
    wrapRef.current?.setAttribute('data-ready', 'true');
    if (handleRef) {
      handleRef.current = {
        focus: () => instance.focus(),
        revealLine: (line, column = 1) => {
          instance.revealLineInCenter(line);
          instance.setPosition({ lineNumber: line, column });
          instance.focus();
        },
      };
    }
  };

  useEffect(
    () => () => {
      if (handleRef) handleRef.current = null;
    },
    [handleRef]
  );

  return (
    <div ref={wrapRef} className={s.wrap} data-testid="code-editor" data-language={language}>
      <Monaco
        language={LANGUAGE_META[language as SupportedLanguage]?.monaco ?? language}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        theme={themeName(theme)}
        loading={<EditorPlaceholder />}
        options={{
          ariaLabel,
          readOnly,
          fontSize: 13,
          lineHeight: 20,
          fontLigatures: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderLineHighlight: 'line',
          padding: { top: 12, bottom: 12 },
          tabSize: 4,
          // gofmt indents with tabs; everything else with spaces.
          insertSpaces: language !== 'go',
          automaticLayout: true,
          fixedOverflowWidgets: true,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          guides: { indentation: true },
          bracketPairColorization: { enabled: false },
          stickyScroll: { enabled: false },
          wordBasedSuggestions: 'currentDocument',
          quickSuggestions: { other: true, comments: false, strings: false },
          accessibilitySupport: 'auto',
        }}
      />
    </div>
  );
}

/** Code-shaped skeleton shown while Monaco downloads. */
export function EditorPlaceholder() {
  const widths = [46, 62, 38, 71, 55, 30, 66, 42, 24, 51];
  return (
    <div className={s.placeholder} role="status" aria-live="polite">
      <span className="sr-only">Loading the editor…</span>
      {widths.map((w, i) => (
        <div key={i} className={s.placeholderLine} aria-hidden="true">
          <span className={s.placeholderGutter}>{i + 1}</span>
          <span className="skel" style={{ width: `${w}%`, height: 9 }} />
        </div>
      ))}
    </div>
  );
}
