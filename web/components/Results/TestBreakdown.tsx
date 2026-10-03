'use client';

import { useEffect, useId, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatKb, formatMicros, text } from '@/lib/client/format';
import { formatValue, namedArgs } from '@/lib/client/signature';
import type { TestEventData } from '@/lib/sse';
import type { Signature } from '@/lib/types';
import { JudgeOutput } from './JudgeOutput';
import s from './Results.module.css';

/** "Sample" · "Custom" · "Hidden" — what kind of test this is. */
export function testKind(t: Pick<TestEventData, 'hidden' | 'custom'>): 'Sample' | 'Custom' | 'Hidden' {
  return t.hidden ? 'Hidden' : t.custom ? 'Custom' : 'Sample';
}

/** The kind of a test as a small quiet label (a lock before "Hidden"), not a tag. */
export function TestKindLabel({ test }: { test: Pick<TestEventData, 'hidden' | 'custom'> }) {
  const kind = testKind(test);
  return (
    <span className={s.testKind} data-kind={kind.toLowerCase()}>
      {test.hidden && <Icon name="lock" size={12} />}
      {kind}
    </span>
  );
}

interface TestDetailsProps {
  test: TestEventData;
  signature: Signature | null;
  onLine?: (line: number, column?: number) => void;
  /** Leave the test's own error line out (the verdict above already says it, e.g. "Time limit exceeded"). */
  quietError?: boolean;
}

/**
 * What one test says: its input, what was expected and what your code
 * returned (in words, values in monospace), the error if it crashed, and the
 * author's note on a failure. Hidden tests show only whether they passed
 * (plus the note on a failure).
 */
export function TestDetails({ test: t, signature, onLine, quietError = false }: TestDetailsProps) {
  return (
    <div className={s.testDetails}>
      {!t.hidden && (
        <dl className={s.io}>
          <dt>Input</dt>
          <dd>
            {namedArgs(signature, t.input).map((a) => (
              <div key={a.name} className={`${s.value} mono`}>
                <span className={s.argName}>{a.name}</span> = {formatValue(a.value)}
              </div>
            ))}
          </dd>
          <dt>Expected</dt>
          <dd>
            <div className={`${s.value} mono`}>{formatValue(t.expected)}</div>
          </dd>
          <dt>Your output</dt>
          <dd>
            <div className={`${s.value} mono`} data-wrong={!t.passed || undefined}>
              {t.actual === undefined || (t.actual === null && t.error) ? <span className={s.none}>no output</span> : formatValue(t.actual)}
            </div>
          </dd>
        </dl>
      )}
      {t.hidden && <p className={s.hiddenNote}>Hidden tests show only whether they passed.</p>}
      {t.error && !t.hidden && !quietError && <JudgeOutput text={t.error} onLine={onLine} label={`Test ${t.idx + 1} error`} />}
      {t.error && t.hidden && <p className={s.hiddenErr}>{t.error}</p>}
      {t.explainOnFail && !t.passed && (
        <p className={s.note} data-testid="explain-on-fail">
          <strong>What this test checks.</strong> {t.explainOnFail}
        </p>
      )}
    </div>
  );
}

interface TestBreakdownProps {
  tests: TestEventData[];
  signature: Signature | null;
  /** Open this test initially. */
  openIdx?: number | null;
  onLine?: (line: number, column?: number) => void;
  /** A visible title for the list. */
  heading?: string;
}

/**
 * Per-test results, every test one row that opens to its details. Visible
 * tests open to input / expected / output / error; hidden tests show pass or
 * fail only (plus the author's note on a failure).
 */
export function TestBreakdown({ tests, signature, openIdx = null, onLine, heading }: TestBreakdownProps) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set(openIdx != null ? [openIdx] : []));
  const baseId = useId();

  useEffect(() => {
    if (openIdx != null) setOpen(new Set([openIdx]));
  }, [openIdx]);

  if (tests.length === 0) return null;
  const toggle = (idx: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  return (
    <div>
      {heading && <h3 className={s.listTitle}>{heading}</h3>}
      <ol className={s.tests} aria-label="Test results" data-testid="test-breakdown">
        {tests.map((t) => {
          const expandable = !t.hidden || !!t.error || !!t.explainOnFail;
          const isOpen = expandable && open.has(t.idx);
          const panelId = `${baseId}-t${t.idx}`;
          const runtime = formatMicros(t.runtimeUs);
          const memory = formatKb(t.memoryKb);
          const head = (
            <>
              <Icon
                name={t.passed ? 'check-circle' : 'x'}
                size={14}
                className={s.testIcon}
                label={t.passed ? 'Passed' : 'Failed'}
                style={{ color: t.passed ? 'var(--ok-fg)' : 'var(--err-fg)' }}
              />
              <span className={s.testName}>Test {t.idx + 1}</span>
              <TestKindLabel test={t} />
              {!t.passed && t.error && <span className={s.testErr}>{t.error.split('\n')[0]}</span>}
              <span className={s.testSpacer} />
              {!t.hidden && (
                <span className={`${s.testMetric} mono`} title="CPU time · memory">
                  {text(runtime)}
                  {memory.value !== '—' && <span className={s.testMetricDim}> · {text(memory)}</span>}
                </span>
              )}
              {expandable && <Icon name={isOpen ? 'chev-up' : 'chev-down'} size={13} className={s.testChev} />}
            </>
          );
          return (
            <li key={t.idx} className={s.test} data-passed={t.passed} data-testid={`test-row-${t.idx}`}>
              {expandable ? (
                <button type="button" className={`${s.testHead} focus-ring`} aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(t.idx)}>
                  {head}
                </button>
              ) : (
                <div className={s.testHead}>{head}</div>
              )}
              {isOpen && (
                <div id={panelId} className={s.testBody}>
                  <TestDetails test={t} signature={signature} onLine={onLine} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
