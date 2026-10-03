'use client';

import type { Ref } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { NextProblem, WorkspaceMode } from '@/components/Workspace/types';
import { formatKb, formatLimit, formatMicros, formatMillis, formatPercent } from '@/lib/client/format';
import { languageLabel } from '@/lib/client/languages';
import { firstFailures, testLabel, tokenPhrase, VERDICT_LOOK, verdictAdvice, verdictSummary, verdictTitle } from '@/lib/client/resultCopy';
import type { RunKind } from '@/lib/client/runState';
import type { TestEventData, VerdictEventData } from '@/lib/sse';
import type { Signature, SupportedLanguage } from '@/lib/types';
import { JudgeOutput } from './JudgeOutput';
import { TestDetails, TestKindLabel } from './TestBreakdown';
import { TestStrip } from './TestStrip';
import s from './Results.module.css';

interface ResultsHeroProps {
  verdict: VerdictEventData;
  kind: RunKind;
  tests: TestEventData[];
  language: SupportedLanguage;
  signature: Signature | null;
  /** Whole-run CPU limit, for the TLE explanation. */
  timeLimitMs?: number;
  /** question (default) or a gate attempt, where the next step is back to the gate. */
  mode?: WorkspaceMode;
  /** Accepted submit, question mode: the next problem that opens for this learner (null: none left). */
  next?: NextProblem | null;
  /** Accepted submit, gate mode: where the attempt lives. */
  gateHref?: string;
  onLine?: (line: number, column?: number) => void;
  /** Offered after all samples pass on a `run`. */
  onSubmit?: () => void;
  /** After a result that is not a pass, on a phone, where the editor is another pane (CSS shows it there only): back to it. */
  onBackToCode?: () => void;
  /** The headline, so the page can move focus to a fresh result. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The result card (artboard 03), in the order a learner reads it: the headline
 * and its one line; for an accepted solve what it earned and where to go next
 * (Next problem · Back to the map); for anything else what to try and the first
 * failing test, open, in words — and, where the editor is another pane (a
 * phone), the way back to it; then a quiet row of runtime, memory and speed.
 * The verdict code and the language are small labels, not the headline.
 */
export function ResultsHero({
  verdict,
  kind,
  tests,
  language,
  signature,
  timeLimitMs,
  mode = 'question',
  next = null,
  gateHref,
  onLine,
  onSubmit,
  onBackToCode,
  headingRef,
}: ResultsHeroProps) {
  const look = VERDICT_LOOK[verdict.status];
  const ok = verdict.status === 'OK';
  const accepted = ok && kind === 'submit';
  const ranTests = verdict.status !== 'CE' && tests.length > 0;
  const advice = verdictAdvice(verdict.status);
  const failures = firstFailures(tests);
  const hiddenOnly = !ok && !failures.visible && failures.any?.hidden === true;
  const tokens = verdict.tokensAwarded ?? [];
  const badges = verdict.badgesAwarded ?? [];

  const runtime = formatMicros(verdict.runtimeUs);
  const memory = formatKb(verdict.memoryKb);
  const compile = formatMillis(verdict.compileMs);
  const limit = verdict.status === 'TLE' && timeLimitMs ? formatLimit(timeLimitMs) : null;
  const showSpeed = accepted && verdict.percentile != null;
  const hasFacts = ranTests && (runtime.value !== '—' || memory.value !== '—' || verdict.compileMs != null || limit != null || showSpeed);
  // The crash output of the run, unless the failing test below already shows the very same text.
  const showOutput = !!verdict.error && ['CE', 'RE', 'XX', 'MLE'].includes(verdict.status) && failures.visible?.error !== verdict.error;

  return (
    <section className={s.hero} data-tone={look.tone} data-status={verdict.status} aria-labelledby="verdict-title" data-testid="results-hero">
      <div className={s.heroTop}>
        <span className={s.heroIcon} aria-hidden="true">
          <Icon name={look.icon} size={20} strokeWidth={2} />
        </span>
        <div className={s.heroHeading}>
          <h2 id="verdict-title" ref={headingRef} tabIndex={-1} className={s.heroTitle} data-testid="verdict-title">
            {verdictTitle(verdict.status, kind)}
          </h2>
          <p className={s.heroSummary} data-testid="verdict-summary">
            {verdictSummary(verdict, kind, tests, { timeLimitMs, mode })}
          </p>
        </div>
        <p className={s.heroMeta} data-testid="verdict-meta">
          {languageLabel(language)}
          <span className={`${s.heroCode} mono`} aria-hidden="true">
            {verdict.status}
          </span>
        </p>
      </div>

      {accepted && (tokens.length > 0 || badges.length > 0) && (
        <ul className={s.rewards} data-testid="rewards" aria-label="What you earned">
          {tokens.map((t) => (
            <li key={t.topic} className={s.reward} data-kind="tokens">
              <span className={s.rewardIcon} aria-hidden="true">
                <Icon name="coin" size={14} />
              </span>
              <span>
                <strong>{tokenPhrase(t.amount)}</strong> · {t.title}
              </span>
            </li>
          ))}
          {badges.map((b) => (
            <li key={b.slug} className={s.reward} data-kind="badge">
              <span className={s.rewardIcon} aria-hidden="true">
                <Icon name="award" size={14} />
              </span>
              <span>
                <strong>Badge earned</strong> · {b.name}
                {b.description && <span className={s.rewardMore}> — {b.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {accepted && (
        <div className={s.actions} data-testid="result-actions">
          {mode === 'gate' && gateHref ? (
            <ButtonLink href={gateHref} variant="primary" size="lg" icon="shield" className={s.actionBtn} data-testid="back-to-gate">
              Back to the gate
            </ButtonLink>
          ) : next ? (
            <ButtonLink
              href={`/problems/${next.slug}`}
              variant="primary"
              size="lg"
              iconRight="arrow-right"
              className={s.actionBtn}
              title={`${next.title} · ${next.difficulty}`}
              data-testid="next-problem"
            >
              Next problem
            </ButtonLink>
          ) : null}
          <ButtonLink
            href="/map"
            variant={mode !== 'gate' && !next ? 'primary' : 'default'}
            size="lg"
            icon="map"
            className={s.actionBtn}
            data-testid="back-to-map"
          >
            Back to the map
          </ButtonLink>
        </div>
      )}

      {ok && kind === 'run' && onSubmit && (
        <div className={s.actions}>
          <Button variant="primary" size="lg" icon="send" onClick={onSubmit} className={s.actionBtn}>
            Submit
          </Button>
        </div>
      )}

      {advice && (
        <p className={s.advice} data-testid="verdict-advice">
          <strong>What to try.</strong> {advice}
        </p>
      )}

      {showOutput && (
        <JudgeOutput
          text={verdict.error!}
          tone={verdict.status === 'CE' ? 'info' : verdict.status === 'XX' ? 'muted' : 'err'}
          onLine={onLine}
          label={verdict.status === 'CE' ? 'Compiler output' : 'Error output'}
        />
      )}

      {failures.visible && (
        <div className={s.failure} data-testid="first-failure">
          <h3 className={s.failureTitle}>
            Test {failures.visible.idx + 1} failed <TestKindLabel test={failures.visible} />
          </h3>
          <TestDetails test={failures.visible} signature={signature} onLine={onLine} quietError={verdict.status === 'TLE' || verdict.status === 'MLE'} />
        </div>
      )}
      {hiddenOnly && failures.any && (
        <p className={s.hiddenNote} data-testid="first-failure">
          Every visible test passed; {testLabel(failures.any)} did not. Hidden tests show only whether they passed.
        </p>
      )}

      {!ok && verdict.status !== 'XX' && onBackToCode && (
        <div className={`${s.actions} ${s.backToCode}`}>
          <Button variant="default" size="lg" icon="code" onClick={onBackToCode} className={s.actionBtn} data-testid="back-to-code">
            Back to code
          </Button>
        </div>
      )}

      {hasFacts && (
        <div className={s.facts} data-testid="verdict-metrics">
          <dl className={s.factList}>
            {runtime.value !== '—' && (
              <div className={s.fact}>
                <dt>Runtime</dt>{' '}
                <dd className="mono">
                  {runtime.value} <abbr title="microseconds, a millionth of a second">{runtime.unit}</abbr>
                </dd>
              </div>
            )}
            {limit && (
              <div className={s.fact}>
                <dt>Limit</dt>{' '}
                <dd className="mono">{limit}</dd>
              </div>
            )}
            {memory.value !== '—' && (
              <div className={s.fact}>
                <dt>Memory</dt>{' '}
                <dd className="mono">
                  {memory.value} {memory.unit}
                </dd>
              </div>
            )}
            {verdict.compileMs != null && (
              <div className={s.fact}>
                <dt>Compile time</dt>{' '}
                <dd className="mono">
                  {compile.value} {compile.unit}
                </dd>
              </div>
            )}
            {showSpeed && (
              <div className={s.fact} data-testid="percentile" title={`By CPU time: each learner’s latest accepted ${languageLabel(language)} solution of this problem.`}>
                <dt className="sr-only">Speed</dt>{' '}
                <dd className={s.speed}>
                  <Icon name="trend" size={14} />
                  <span>
                    Faster than <strong className="mono">{formatPercent(verdict.percentile)}%</strong> of other learners
                  </span>
                </dd>
              </div>
            )}
          </dl>
          {ok && runtime.unit === 'µs' && runtime.value !== '—' && <p className={s.unitNote}>µs = microseconds. Runtime is CPU time over all tests.</p>}
        </div>
      )}

      {ranTests && !accepted && <TestStrip tests={tests} total={verdict.totalTests} />}
    </section>
  );
}
