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
import { ResultsHero } from '@/components/Results/ResultsHero';
import { RunProgress } from '@/components/Results/RunProgress';
import { TestBreakdown } from '@/components/Results/TestBreakdown';
import { clearDraft, loadDraft, loadLanguage, saveDraft, saveLanguage } from '@/lib/client/drafts';
import { formatPercent } from '@/lib/client/format';
import { LANGUAGE_META, languageLabel, linkErrorLines } from '@/lib/client/languages';
import type { RunKind } from '@/lib/client/runState';
import { useRunStream } from '@/lib/client/useRunStream';
import type { VerdictEventData } from '@/lib/sse';
import type { SupportedLanguage } from '@/lib/types';
import { CasesPanel, customInputs, type CustomCase } from './CasesPanel';
import { GateBanner } from './GateBanner';
import { RunErrorNotice } from './RunErrorNotice';
import { StatementPane } from './StatementPane';
import type { BuildContext, GateContext, SubmissionSummary, WorkspaceMode, WorkspaceProblem } from './types';
import { useModKey } from './useModKey';
import { useSplit } from './useSplit';
import s from './Workspace.module.css';

const AiReview = dynamic(() => import('@/components/Results/AiReview').then((m) => m.AiReview), { ssr: false });

export interface SolveWorkspaceProps {
  /** question (catalog) · build (a component build step, /api/build) · gate (Submit counts for the attempt). */
  mode: WorkspaceMode;
  problem: WorkspaceProblem;
  /** Server-rendered statement body (or the build step's prompt). */
  statement: ReactNode;
  /** Server-rendered editorial (question mode; hidden behind a spoiler until solved). */
  editorial?: ReactNode;
  /** Eyebrow over the title, e.g. a breadcrumb or "Build · Prefix sums". */
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
  /** build mode: the component being built. */
  build?: BuildContext;
  /** Already has an accepted submission. */
  solved?: boolean;
  bestPercentile?: number | null;
  /** FEATURE_AI_REVIEW is on (and a key is configured). */
  aiReview?: boolean;
  /** Called with every verdict (e.g. /queue advancing after a passing build). */
  onVerdict?: (verdict: VerdictEventData, kind: RunKind) => void;
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
 * The solving surface shared by /problems/[slug] (question, gate) and the
 * learning loop's build steps: statement · editor · console. Monaco loads
 * lazily; drafts persist per problem and language; ⌘/Ctrl+Enter runs and
 * ⌘/Ctrl+Shift+Enter submits. Two resizable columns from 1024 px up,
 * stacked below.
 */
export function SolveWorkspace(props: SolveWorkspaceProps) {
  const { mode, problem, gate, build } = props;
  const { toast } = useToast();
  const mod = useModKey();
  const scope = mode === 'build' ? `b:${problem.id}` : `q:${problem.id}`;
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
      if (mode === 'build') {
        kind = 'build';
        body = { buildStepId: problem.id, language, code };
      } else if (action === 'run') {
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
        const tokens = verdict.tokensAwarded ?? [];
        toast({
          tone: 'ok',
          title: mode === 'gate' ? 'Accepted — counts for the gate' : 'Accepted',
          description: [
            tokens.length ? tokens.map((t) => `+${t.amount} ${t.title}`).join(' · ') : null,
            verdict.percentile != null ? `beats ${formatPercent(verdict.percentile)}%` : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        });
        if (mode === 'gate' && currentSlug) setGateSolved((prev) => new Set(prev).add(currentSlug));
      }
      if (verdict.status === 'OK' && kind === 'build') {
        setSolved(true);
        if (verdict.tokensAwarded?.length) {
          toast({ tone: 'ok', title: 'Build passed', description: verdict.tokensAwarded.map((t) => `+${t.amount} ${t.title}`).join(' · ') });
        }
      }
      // Layouts don't re-render on their own: refresh so the navbar's token
      // total reflects what was just awarded (editor state is client-side and
      // survives the refresh).
      if (verdict.tokensAwarded?.length) router.refresh();
      for (const b of verdict.badgesAwarded ?? []) {
        toast({ tone: 'info', title: `Badge earned: ${b.name}`, description: b.description, duration: 8000 });
      }
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
      props.onVerdict?.(verdict, kind);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.busy, run.start, code, language, cases, mode, problem.id, problem.signature, gate, gateOver, currentSlug, toast, props.onVerdict, router]
  );

  const executeRef = useRef(execute);
  executeRef.current = execute;
  const onRun = useCallback(() => void executeRef.current('run'), []);
  const onSubmit = useCallback(() => void executeRef.current(mode === 'build' ? 'run' : 'submit'), [mode]);

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
  const rows = useSplit('rows', rightRef, { initial: 60, min: 25, max: 82, axis: 'y', label: 'Resize the editor and console' });
  const layoutStyle = { '--left': `${cols.ratio}%`, '--top': `${rows.ratio}%` } as CSSProperties;

  const verdict = run.phase === 'done' ? run.verdict : null;
  const firstFailing = verdict ? run.tests.find((t) => !t.passed && !t.hidden)?.idx ?? null : null;
  const runLabel = mode === 'build' ? 'Run tests' : 'Run';
  const canSubmit = mode !== 'build';

  const eyebrow =
    props.eyebrow ??
    (build ? (
      <>
        Build · <span className={s.eyebrowStrong}>{build.componentTitle}</span>
        {build.dependencies.length > 0 && <> · uses {build.dependencies.map((d) => d.title).join(', ')}</>}
      </>
    ) : null);

  // The page's main landmark — except in build mode, where BuildStep wraps
  // the workspace (and its queue bar) in one.
  const Root = mode === 'build' ? 'div' : 'main';
  return (
    <Root className={s.root} data-mode={mode} style={layoutStyle}>
      {gate && <GateBanner gate={gate} currentSlug={currentSlug} solved={gateSolved} onExpire={() => setGateOver(true)} />}
      <div ref={splitRef} className={s.split}>
        <section className={`${s.pane} ${s.left}`} aria-label="Problem">
          <StatementPane
            mode={mode}
            problem={problem}
            eyebrow={eyebrow}
            statement={props.statement}
            editorial={props.editorial}
            submissions={mode === 'build' ? undefined : submissions}
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
                variant={canSubmit ? 'default' : 'primary'}
                size="sm"
                icon="play"
                onClick={onRun}
                loading={run.busy && run.kind !== 'submit'}
                disabled={run.busy && run.kind === 'submit'}
                kbd={`${mod}↵`}
                data-testid="run-button"
              >
                {runLabel}
              </Button>
              {canSubmit && (
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
              )}
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
                    allowCustom={mode !== 'build' && !!problem.customInputs}
                    canSubmit={canSubmit}
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
                          <Kbd bare>{mod}↵</Kbd> runs the samples{canSubmit ? <>, <Kbd bare>{mod}⇧↵</Kbd> submits</> : null}. Runtime is CPU time in µs.
                        </>
                      }
                    />
                  )}
                  {run.busy && <RunProgress phase={run.phase} kind={run.kind} tests={run.tests} total={run.totalTests} language={languageLabel(language)} />}
                  {run.phase === 'failed' && run.error && <RunErrorNotice error={run.error} onRetry={() => void execute(run.kind === 'submit' ? 'submit' : 'run')} />}
                  {run.phase === 'cancelled' && (
                    <EmptyState size="sm" icon="x" headingLevel={3} title="Cancelled" description="The run was stopped before its verdict." />
                  )}
                  {verdict && run.kind && (
                    <>
                      <ResultsHero
                        verdict={verdict}
                        kind={run.kind}
                        tests={run.tests}
                        language={language}
                        timeLimitMs={problem.timeLimitMs}
                        onLine={onLine}
                        onSubmit={canSubmit && run.kind === 'run' ? onSubmit : undefined}
                        onSelectTest={(idx) => document.querySelector<HTMLElement>(`[data-testid="test-row-${idx}"] button`)?.focus()}
                      />
                      {props.aiReview && verdict.status === 'OK' && run.kind === 'submit' && verdict.submissionId && (
                        <AiReview submissionId={verdict.submissionId} />
                      )}
                      <TestBreakdown tests={run.tests} signature={problem.signature} openIdx={firstFailing} onLine={onLine} />
                    </>
                  )}
                  <div className="sr-only" role="status" aria-live="polite">
                    {verdict ? `${verdict.status === 'OK' ? 'Passed' : verdict.status}: ${verdict.totalPassed} of ${verdict.totalTests} tests passed.` : ''}
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
    </Root>
  );
}
