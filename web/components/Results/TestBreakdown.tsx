'use client';

import { useEffect, useId, useState } from 'react';
import { Callout } from '@/components/ui/Callout';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { formatKb, formatMicros, text } from '@/lib/client/format';
import { formatValue, namedArgs } from '@/lib/client/signature';
import type { TestEventData } from '@/lib/sse';
import type { Signature } from '@/lib/types';
import { JudgeOutput } from './JudgeOutput';
import s from './Results.module.css';

interface TestBreakdownProps {
  tests: TestEventData[];
  signature: Signature | null;
  /** Open this test initially — usually the first failure. */
  openIdx?: number | null;
  onLine?: (line: number, column?: number) => void;
}

/**
 * Per-test results. Visible tests open to input / expected / output /
 * error; hidden tests show pass or fail only (plus the author's note on a
 * failure). `explain_on_fail` notes appear on failures.
 */
export function TestBreakdown({ tests, signature, openIdx = null, onLine }: TestBreakdownProps) {
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
    <ol className={s.tests} aria-label="Test results" data-testid="test-breakdown">
      {tests.map((t) => {
        const expandable = !t.hidden || !!t.error || !!t.explainOnFail;
        const isOpen = expandable && open.has(t.idx);
        const panelId = `${baseId}-t${t.idx}`;
        const kind = t.hidden ? 'Hidden' : t.custom ? 'Custom' : 'Sample';
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
            <Pill size="xs" tone={t.hidden ? 'muted' : t.custom ? 'info' : 'default'} icon={t.hidden ? 'lock' : undefined}>
              {kind}
            </Pill>
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
                    <dt>Output</dt>
                    <dd>
                      <div className={`${s.value} mono`} data-wrong={!t.passed || undefined}>
                        {t.actual === undefined || (t.actual === null && t.error) ? <span className={s.none}>no output</span> : formatValue(t.actual)}
                      </div>
                    </dd>
                  </dl>
                )}
                {t.hidden && <p className={s.hiddenNote}>Hidden tests show only whether they passed.</p>}
                {t.error && !t.hidden && <JudgeOutput text={t.error} onLine={onLine} label={`Test ${t.idx + 1} error`} />}
                {t.error && t.hidden && <p className={s.hiddenErr}>{t.error}</p>}
                {t.explainOnFail && !t.passed && (
                  <Callout kind="pitfall" title="What this test checks">
                    {t.explainOnFail}
                  </Callout>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
