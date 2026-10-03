'use client';

import { EmptyState } from '@/components/states/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { VerdictText } from '@/components/Results/VerdictText';
import { isStatusCode, type StatusCode } from '@/components/ui/StatusPill';
import { formatKb, formatMillis, text } from '@/lib/client/format';
import { languageLabel } from '@/lib/client/languages';
import type { IdeExecutionResponse, IdeTestResult, SupportedLanguage } from '@/lib/types';
import s from './IDE.module.css';

interface IdeOutputDisplayProps {
  results: IdeExecutionResponse | null;
  pending?: boolean;
  language?: SupportedLanguage;
}

type DiffLine = { kind: 'same' | 'del' | 'add'; text: string };

/** Line diff of expected vs actual stdout (trailing whitespace ignored, like the judge). */
export function diffLines(expected: string, actual: string): DiffLine[] {
  const exp = expected.replace(/\s+$/, '').split('\n');
  const act = actual.replace(/\s+$/, '').split('\n');
  const out: DiffLine[] = [];
  for (let i = 0; i < Math.max(exp.length, act.length); i++) {
    const e = exp[i];
    const a = act[i];
    if (e !== undefined && a !== undefined && e.trimEnd() === a.trimEnd()) out.push({ kind: 'same', text: a });
    else {
      if (e !== undefined) out.push({ kind: 'del', text: e });
      if (a !== undefined) out.push({ kind: 'add', text: a });
    }
  }
  return out;
}

/** A case's status: an unanswered expectation isn't a wrong answer. */
function caseStatus(r: IdeTestResult, compared: boolean): StatusCode {
  const status = r.status;
  if (status && isStatusCode(status)) {
    if (status === 'WA' && !compared) return 'OK';
    return status;
  }
  if (r.error) return 'XX';
  return !compared || r.passed ? 'OK' : 'WA';
}

function Block({ label, value, tone }: { label: string; value: string; tone?: 'err' | 'dim' }) {
  return (
    <div className={s.block}>
      <span className={s.blockLabel}>{label}</span>
      <pre className={`${s.pre} mono`} data-tone={tone}>
        {value === '' ? <span className={s.empty}>(empty)</span> : value}
      </pre>
    </div>
  );
}

/**
 * One-line outcome of a run, for the IDE's live region: the visible summary
 * is re-rendered on completion, so screen readers need it announced.
 */
export function runSummary(results: IdeExecutionResponse): string {
  if (results.testResults.length === 0) return `Run failed: ${results.error ?? 'nothing ran.'}`;
  if (results.testResults.some((r) => r.status === 'CE')) return 'Run finished: compilation failed — nothing ran.';
  const compared = results.testResults.map((r) => r.expectedOutput.trim() !== '');
  const comparedCount = compared.filter(Boolean).length;
  const matched = results.testResults.filter((r, i) => compared[i] && r.passed).length;
  const failed = results.testResults.map((r, i) => caseStatus(r, compared[i])).filter((c) => c !== 'OK').length;
  const cases = `${results.testResults.length} case${results.testResults.length === 1 ? '' : 's'} ran`;
  if (comparedCount > 0) return `Run finished: ${matched} of ${comparedCount} expected outputs matched; ${cases}.`;
  return `Run finished: ${cases}${failed ? `, ${failed} with errors` : ''}.`;
}

/** Per-case results: status, runtime and memory, stdin, stdout, a diff against the expectation, errors. */
export function IdeOutputDisplay({ results, pending = false, language }: IdeOutputDisplayProps) {
  if (pending) {
    return (
      <div className={s.outputState} role="status">
        <Spinner size={16} />
        <span>Running{language ? ` ${languageLabel(language)}` : ''}…</span>
      </div>
    );
  }
  if (!results) {
    return (
      <EmptyState
        size="sm"
        icon="terminal"
        headingLevel={2}
        title="No output yet"
        description="Run your code to see stdout, runtime and memory for every case."
      />
    );
  }
  if (results.testResults.length === 0) {
    return (
      <div className={s.outputBody} tabIndex={0}>
        <div className={s.summary} data-tone="err">
          <Icon name="alert-circle" size={16} />
          <span>{results.error ?? 'Nothing ran.'}</span>
        </div>
      </div>
    );
  }

  const ce = results.testResults.find((r) => r.status === 'CE');
  const compared = results.testResults.map((r) => r.expectedOutput.trim() !== '');
  const statuses = results.testResults.map((r, i) => caseStatus(r, compared[i]));
  const matched = results.testResults.filter((r, i) => compared[i] && r.passed).length;
  const comparedCount = compared.filter(Boolean).length;
  const worst: StatusCode = ce ? 'CE' : statuses.find((c) => c !== 'OK') ?? 'OK';

  return (
    <div className={`${s.outputBody} scroll`} tabIndex={0}>
      <div className={s.summary} data-tone={worst === 'OK' ? 'ok' : worst === 'CE' ? 'info' : worst === 'TLE' || worst === 'MLE' ? 'warn' : 'err'}>
        <VerdictText
          status={worst}
          kind="run"
          size="md"
          label={worst === 'OK' ? (comparedCount > 0 ? 'All matched' : 'Ran') : worst === 'WA' ? 'Mismatch' : undefined}
        />
        <span className={s.summaryText}>
          {ce
            ? 'Compilation failed — nothing ran.'
            : comparedCount > 0
              ? `${matched} of ${comparedCount} expected output${comparedCount === 1 ? '' : 's'} matched`
              : `${results.testResults.length} case${results.testResults.length === 1 ? '' : 's'} ran`}
        </span>
        {language && <span className={s.summaryLang}>{languageLabel(language)}</span>}
      </div>

      {ce?.error && (
        <pre className={`${s.pre} ${s.compileOut} mono`} aria-label="Compiler output">
          {ce.error}
        </pre>
      )}

      {!ce && (
        <ol className={s.results}>
          {results.testResults.map((r, i) => {
            const code = statuses[i];
            const runtime = formatMillis(r.runMs ?? r.executionTime);
            const memory = formatKb(r.memoryKb);
            const wrong = compared[i] && !r.passed && (code === 'OK' || code === 'WA');
            return (
              <li key={i} className={s.result} data-status={code} data-testid={`ide-case-${i}`}>
                <div className={s.resultHead}>
                  <span className={s.resultName}>Case {i + 1}</span>
                  <VerdictText status={code} variant="code" />
                  {!compared[i] && <span className={s.resultNote}>no expected output</span>}
                  <span className={s.spacer} />
                  <span className={`${s.resultMetric} mono`} title="CPU time · peak memory">
                    {text(runtime)}
                    {memory.value !== '—' && <span className={s.dim}> · {text(memory)}</span>}
                  </span>
                </div>
                <div className={s.resultBody}>
                  <Block label="stdin" value={r.input} tone="dim" />
                  {wrong ? (
                    <div className={s.block}>
                      <span className={s.blockLabel}>
                        diff
                        <span className={s.legend}>− expected</span>
                        <span className={s.legend}>+ yours</span>
                      </span>
                      <pre className={`${s.pre} ${s.diff} mono`} aria-label="Expected output versus your output">
                        {diffLines(r.expectedOutput, r.actualOutput).map((l, k) => (
                          <span key={k} className={s.diffLine} data-kind={l.kind}>
                            <span className={s.diffSign} aria-hidden="true">
                              {l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' '}
                            </span>
                            <span className="sr-only">{l.kind === 'del' ? 'expected: ' : l.kind === 'add' ? 'yours: ' : ''}</span>
                            {l.text || ' '}
                          </span>
                        ))}
                      </pre>
                    </div>
                  ) : (
                    <Block label="stdout" value={r.actualOutput} />
                  )}
                  {r.error && <Block label={code === 'TLE' ? 'limit' : 'stderr'} value={r.error} tone="err" />}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
