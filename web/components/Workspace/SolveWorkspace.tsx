'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/states/EmptyState';
import { Kbd } from '@/components/ui/Kbd';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { CodeEditor, type CodeEditorHandle, type EditorMarker } from '@/components/Editor/CodeEditor';
import { LanguageSelector } from '@/components/Editor/LanguageSelector';
import type { HintLadderProps } from '@/components/Hints/HintLadder';
import { clearDraft, loadDraft, loadLanguage, saveDraft, saveLanguage } from '@/lib/client/drafts';
import { LANGUAGE_META, languageLabel, linkErrorLines } from '@/lib/client/languages';
import { verdictSummary, verdictTitle } from '@/lib/client/resultCopy';
import type { RunKind } from '@/lib/client/runState';
import { useRunStream } from '@/lib/client/useRunStream';
import type { SupportedLanguage } from '@/lib/types';
import { CasesPanel, customInputs, type CustomCase } from './CasesPanel';
import { GateBanner } from './GateBanner';
import { RunErrorNotice } from './RunErrorNotice';
import { StatementPane } from './StatementPane';
import type { GateContext, NextProblem, SubmissionSummary, WorkspaceMode, WorkspaceProblem } from './types';
import { useModKey } from './useModKey';
import { useSplit } from './useSplit';
import s from './Workspace.module.css';

// The live result (progress, card, per-test list) is needed only once a run starts: its code and styles load
// after the page is interactive (and are fetched ahead of the first run), not with the first paint.
const loadResultPanel = () => import('@/components/Results/ResultPanel').then((m) => m.ResultPanel);
const ResultPanel = dynamic(loadResultPanel, { ssr: false, loading: () => <p className={s.muted}>Working…</p> });

export interface SolveWorkspaceProps {
  /** question (a published question) · gate (Submit counts for the attempt). */
  mode: WorkspaceMode;
  problem: WorkspaceProblem;
  /** Server-rendered statement body. */
  statement: ReactNode;
  /** Server-rendered editorial (question mode; hidden behind a spoiler until solved). */
  editorial?: ReactNode;
  /** Eyebrow over the title, e.g. a breadcrumb. */
  eyebrow?: ReactNode;
  /** The learner's recent submissions of this question, newest first. */
  submissions?: SubmissionSummary[];
  /** Latest code per language from the server — used when there's no local draft. */
  latestCode?: Partial<Record<SupportedLanguage, string>>;
  /** Language to start in when nothing is stored locally. */
  initialLanguage?: SupportedLanguage;
  /** Hint ladder (omit for none; never shown in gate mode). */
  hints?: Omit<HintLadderProps, 'solved'> | null;
  /** gate mode: the running attempt. */
  gate?: GateContext;
  /** Already has an accepted submission. */
  solved?: boolean;
  bestPercentile?: number | null;
  /** The next unsolved problem that opens for this learner — "Next problem" after an accepted solve (null: none left). */
  nextProblem?: NextProblem | null;
  /** FEATURE_AI_REVIEW is on (and a key is configured). */
  aiReview?: boolean;
}

type ConsoleTab = 'cases' | 'result';

function markersFrom(error: string): EditorMarker[] {
  const message = error.split('\n').find((l) => l.trim()) ?? 'Compilation error';
  const seen = new Set<number>();
  return linkErrorLines(error)
    .filter((seg) => seg.line && !seen.has(seg.line) && seen.add(seg.line))
    .slice(0, 20)
    .map((seg) => ({ line: seg.line!, column: seg.column, message }));
}

/**
 * The solving surface of /problems/[slug] (question and gate mode):
 * statement · editor · console. Monaco loads lazily; drafts persist per
 * problem and language; ⌘/Ctrl+Enter runs and ⌘/Ctrl+Shift+Enter submits.
 * Two resizable columns from 1024 px up, stacked below.
 */
export function SolveWorkspace(props: SolveWorkspaceProps) {
  const { mode, problem, gate } = props;
  const { toast } = useToast();
  const mod = useModKey();
  const scope = `q:${problem.id}`;
  const languages = problem.languages;
  const starter = useCallback((l: SupportedLanguage) => problem.starterCode[l] ?? '', [problem.starterCode]);
  const serverCode = useCallback((l: SupportedLanguage) => props.latestCode?.[l] ?? starter(l), [props.latestCode, starter]);

  const firstLanguage = props.initialLanguage && languages.includes(props.initialLanguage) ? props.initialLanguage : languages[0];
  const [language, setLanguage] = useState<SupportedLanguage>(firstLanguage);
  const [code, setCode] = useState(() => serverCode(firstLanguage));
  const [restored, setRestored] = useState(false);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('cases');
  const [cases, setCases] = useState<CustomCase[]>([]);
  const [selectedCase, setSelectedCase] = useState('s0');
  const [casesError, setCasesError] = useState<string | null>(null);
  const router = useRouter();
  const [solved, setSolved] = useState(!!props.solved);
  const [best, setBest] = useState(props.bestPercentile ?? null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>(props.submissions ?? []);
  const [gateSolved, setGateSolved] = useState<ReadonlySet<string>>(() => new Set(gate?.questions.filter((q) => q.solved).map((q) => q.slug)));
  const [gateOver, setGateOver] = useState(false);
  const editor = useRef<CodeEditorHandle | null>(null);
  const run = useRunStream();

  const currentSlug = problem.slug;

  // Local drafts and the last language load after hydration (the server can't see them).
  useEffect(() => {
    const lang = loadLanguage(scope, languages) ?? firstLanguage;
    setLanguage(lang);
    setCode(loadDraft(scope, lang) ?? serverCode(lang));
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    if (!restored) return;
    const t = window.setTimeout(() => saveDraft(scope, language, code, starter(language)), 350);
    return () => window.clearTimeout(t);
  }, [code, language, restored, scope, starter]);

  // Fetch the result panel ahead of the first run, once the page has had its moment.
  useEffect(() => {
    const warm = () => void loadResultPanel();
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(t);
  }, []);

  const switchLanguage = (next: SupportedLanguage) => {
    if (next === language) return;
    saveDraft(scope, language, code, starter(language));
    saveLanguage(scope, next);
    setLanguage(next);
    setCode(loadDraft(scope, next) ?? serverCode(next));
    setMarkers([]);
  };

  const resetToStarter = () => {
    clearDraft(scope, language);
    setCode(starter(language));
    setMarkers([]);
    setConfirmReset(false);
    editor.current?.focus();
  };

  const execute = useCallback(
    async (action: 'run' | 'submit') => {
      if (run.busy) return;
      if (!code.trim()) {
        toast({ tone: 'warn', title: 'Nothing to run', description: 'Write some code first.' });
        return;
      }
      if (mode === 'gate' && gateOver && action === 'submit') {
        toast({ tone: 'warn', title: 'Time’s up', description: 'This gate attempt has ended.' });
        return;
      }
      let kind: RunKind;
      let body: Record<string, unknown>;
      if (action === 'run') {
        const custom = customInputs(problem.signature, cases, language);
        if (!custom.ok) {
          setConsoleTab('cases');
          setSelectedCase(cases[custom.index].id);
          setCasesError(`Custom ${custom.index + 1} has an invalid value — fix it or remove the case.`);
          return;
        }
        kind = 'run';
        body = { questionId: problem.id, language, code, ...(custom.inputs.length ? { customInputs: custom.inputs } : {}) };
      } else {
        kind = 'submit';
        body = { questionId: problem.id, language, code, ...(mode === 'gate' && gate ? { attemptId: gate.attemptId } : {}) };
      }
      setCasesError(null);
      setConsoleTab('result');
      setMarkers([]);
      const verdict = await run.start(kind, body);
      if (!verdict) return;

      if (verdict.status === 'CE' && verdict.error) setMarkers(markersFrom(verdict.error));
      if (verdict.status === 'OK' && kind === 'submit') {
        setSolved(true);
        if (verdict.percentile != null) setBest((b) => (b == null ? verdict.percentile! : Math.max(b, verdict.percentile!)));
        if (mode === 'gate' && currentSlug) setGateSolved((prev) => new Set(prev).add(currentSlug));
      }
      // What was earned (tokens, badges) is on the result card itself — no toast on top of it.
      // Layouts don't re-render on their own: refresh so the navbar's token
      // total reflects what was just awarded (editor state is client-side and
      // survives the refresh).
      if (verdict.tokensAwarded?.length) router.refresh();
      if (kind === 'submit' && verdict.submissionId) {
        setSubmissions((prev) => [
          {
            id: verdict.submissionId!,
            kind: mode === 'gate' ? 'gate' : 'submit',
            status: verdict.status,
            language,
            runtimeUs: verdict.runtimeUs,
            memoryKb: verdict.memoryKb,
            percentile: verdict.percentile ?? null,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.busy, run.start, code, language, cases, mode, problem.id, problem.signature, gate, gateOver, currentSlug, toast, router]
  );

  const executeRef = useRef(execute);
  executeRef.current = execute;
  const onRun = useCallback(() => void executeRef.current('run'), []);
  const onSubmit = useCallback(() => void executeRef.current('submit'), []);

  // ⌘/Ctrl+Enter anywhere on the page (Monaco binds its own while focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog owns the keyboard
      e.preventDefault();
      if (e.shiftKey) onSubmit();
      else onRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRun, onSubmit]);

  const onLine = useCallback((line: number, column?: number) => editor.current?.revealLine(line, column), []);

  // ─── layout ────────────────────────────────────────────────────────────
  const splitRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const cols = useSplit('cols', splitRef, { initial: 42, min: 26, max: 62, axis: 'x', label: 'Resize the problem and editor panes' });
  const rows = useSplit('rows', rightRef, { initial: 56, min: 25, max: 82, axis: 'y', label: 'Resize the editor and console' });
  const layoutStyle = { '--left': `${cols.ratio}%`, '--top': `${rows.ratio}%` } as CSSProperties;

  const verdict = run.phase === 'done' ? run.verdict : null;

  return (
    <main className={s.root} data-mode={mode} style={layoutStyle}>
      {gate && <GateBanner gate={gate} currentSlug={currentSlug} solved={gateSolved} onExpire={() => setGateOver(true)} />}
      <div ref={splitRef} className={s.split}>
        <section className={`${s.pane} ${s.left}`} aria-label="Problem">
          <StatementPane
            mode={mode}
            problem={problem}
            eyebrow={props.eyebrow}
            statement={props.statement}
            editorial={props.editorial}
            submissions={submissions}
            hints={props.hints}
            solved={solved}
            bestPercentile={best}
          />
        </section>

        <div className={`${s.sep} ${s.vsep}`} {...cols.separatorProps} />

        <div ref={rightRef} className={s.right}>
          <section className={`${s.pane} ${s.editorPane}`} aria-label="Code">
            <div className={s.toolbar}>
              <LanguageSelector value={language} onChange={switchLanguage} languages={languages} disabled={run.busy} />
              <Tooltip content="Reset to the starter code">
                <Button variant="ghost" size="sm" icon="refresh" aria-label="Reset to the starter code" onClick={() => setConfirmReset(true)} disabled={run.busy} />
              </Tooltip>
              <span className={s.toolbarSpacer} />
              {run.busy ? (
                <Button variant="ghost" size="sm" icon="x" onClick={run.cancel} data-testid="cancel-run">
                  Cancel
                </Button>
              ) : null}
              <Button
                size="sm"
                icon="play"
                onClick={onRun}
                loading={run.busy && run.kind !== 'submit'}
                disabled={run.busy && run.kind === 'submit'}
                kbd={`${mod}↵`}
                data-testid="run-button"
              >
                Run
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon="send"
                onClick={onSubmit}
                loading={run.busy && run.kind === 'submit'}
                disabled={(run.busy && run.kind !== 'submit') || (mode === 'gate' && gateOver)}
                kbd={`${mod}⇧↵`}
                data-testid="submit-button"
              >
                Submit
              </Button>
            </div>
            <div className={s.editorArea}>
              <CodeEditor
                language={language}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (markers.length) setMarkers([]);
                }}
                onRun={onRun}
                onSubmit={onSubmit}
                markers={markers}
                ariaLabel={`${LANGUAGE_META[language].label} code for ${problem.title}`}
                handleRef={editor}
              />
            </div>
          </section>

          <div className={`${s.sep} ${s.hsep}`} {...rows.separatorProps} />

          <section className={`${s.pane} ${s.console}`} aria-label="Console">
            <div className={s.consoleHead}>
              <Tabs
                tabs={[
                  { value: 'cases', label: 'Test cases', icon: 'list', count: problem.samples.length + cases.length || undefined },
                  { value: 'result', label: 'Result', icon: 'terminal' },
                ]}
                value={consoleTab}
                onChange={(v) => setConsoleTab(v as ConsoleTab)}
                size="sm"
                aria-label="Console"
              />
            </div>
            <div className={`${s.consoleBody} scroll`} data-testid="console">
              {consoleTab === 'cases' ? (
                <>
                  {casesError && (
                    <p className={s.inlineError} role="alert">
                      {casesError}
                    </p>
                  )}
                  <CasesPanel
                    signature={problem.signature}
                    samples={problem.samples}
                    cases={cases}
                    onCasesChange={(next) => {
                      setCases(next);
                      setCasesError(null);
                    }}
                    allowCustom={!!problem.customInputs}
                    language={language}
                    selected={selectedCase}
                    onSelect={setSelectedCase}
                  />
                </>
              ) : (
                <div className={s.result} aria-live="off">
                  {run.phase === 'idle' && (
                    <EmptyState
                      size="sm"
                      icon="play"
                      headingLevel={3}
                      title="No results yet"
                      description={
                        <>
                          <Kbd bare>{mod}↵</Kbd> runs the samples, <Kbd bare>{mod}⇧↵</Kbd> submits. Runtime is CPU time in µs.
                        </>
                      }
                    />
                  )}
                  {run.phase === 'failed' && run.error && <RunErrorNotice error={run.error} onRetry={() => void execute(run.kind === 'submit' ? 'submit' : 'run')} />}
                  {run.phase === 'cancelled' && (
                    <EmptyState size="sm" icon="x" headingLevel={3} title="Cancelled" description="The run was stopped before its verdict." />
                  )}
                  {(run.busy || verdict) && (
                    <ResultPanel
                      run={run}
                      language={language}
                      languageName={languageLabel(language)}
                      signature={problem.signature}
                      timeLimitMs={problem.timeLimitMs}
                      mode={mode}
                      next={props.nextProblem}
                      gateHref={gate?.backHref}
                      aiReview={props.aiReview}
                      onLine={onLine}
                      onSubmit={onSubmit}
                    />
                  )}
                  <div className="sr-only" role="status" aria-live="polite">
                    {verdict && run.kind ? `${verdictTitle(verdict.status, run.kind)}. ${verdictSummary(verdict, run.kind, run.tests, { timeLimitMs: problem.timeLimitMs, mode })}` : ''}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        role="alertdialog"
        size="sm"
        title="Reset to the starter code?"
        description={`Your ${LANGUAGE_META[language].label} draft for this problem will be replaced. Submitted code stays in your submissions.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Keep my code
            </Button>
            <Button variant="danger" icon="refresh" onClick={resetToStarter}>
              Reset
            </Button>
          </>
        }
      />
    </main>
  );
}
