'use client';

import dynamic from 'next/dynamic';
import type { Ref } from 'react';
import type { NextProblem, WorkspaceMode } from '@/components/Workspace/types';
import type { RunState } from '@/lib/client/runState';
import type { Signature, SupportedLanguage } from '@/lib/types';
import { ResultsHero } from './ResultsHero';
import { RunProgress } from './RunProgress';
import { TestBreakdown } from './TestBreakdown';

const AiReview = dynamic(() => import('./AiReview').then((m) => m.AiReview), { ssr: false });

interface ResultPanelProps {
  run: RunState;
  language: SupportedLanguage;
  /** The language's display name, for the progress line. */
  languageName: string;
  signature: Signature | null;
  timeLimitMs?: number;
  mode: WorkspaceMode;
  /** Accepted submit, question mode: the next problem that opens (null: none left). */
  next?: NextProblem | null;
  /** Accepted submit, gate mode: where the attempt lives. */
  gateHref?: string;
  /** FEATURE_AI_REVIEW is on. */
  aiReview?: boolean;
  onLine?: (line: number, column?: number) => void;
  onSubmit?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The live part of the Result tab: the progress of a run while it streams,
 * then the result card and the per-test list. One piece, loaded after the
 * page is interactive (it is needed only once a run starts) so its code and
 * styles stay out of the page's first paint.
 */
export function ResultPanel({ run, language, languageName, signature, timeLimitMs, mode, next, gateHref, aiReview, onLine, onSubmit, headingRef }: ResultPanelProps) {
  if (run.phase === 'connecting' || run.phase === 'queued' || run.phase === 'compiling' || run.phase === 'running') {
    return <RunProgress phase={run.phase} kind={run.kind} tests={run.tests} total={run.totalTests} language={languageName} />;
  }
  const verdict = run.phase === 'done' ? run.verdict : null;
  if (!verdict || !run.kind) return null;
  return (
    <>
      <ResultsHero
        verdict={verdict}
        kind={run.kind}
        tests={run.tests}
        language={language}
        signature={signature}
        timeLimitMs={timeLimitMs}
        mode={mode}
        next={next}
        gateHref={gateHref}
        onLine={onLine}
        onSubmit={run.kind === 'run' ? onSubmit : undefined}
        headingRef={headingRef}
      />
      {aiReview && verdict.status === 'OK' && run.kind === 'submit' && verdict.submissionId && <AiReview submissionId={verdict.submissionId} />}
      <TestBreakdown tests={run.tests} signature={signature} onLine={onLine} heading="All tests" />
    </>
  );
}
