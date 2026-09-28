'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Textarea } from '@/components/ui/Input';
import { Tabs } from '@/components/ui/Tabs';
import { conformanceError, formatValue, namedArgs, parseArgText, valueToText } from '@/lib/client/signature';
import type { Signature, SupportedLanguage } from '@/lib/types';
import type { SampleTest } from './types';
import s from './Workspace.module.css';

/** A learner-added input: one JSON text per parameter. */
export interface CustomCase {
  id: string;
  args: string[];
}

export const MAX_CUSTOM_CASES = 8;

let caseSeq = 0;
export function newCase(args: string[]): CustomCase {
  return { id: `c${Date.now().toString(36)}${++caseSeq}`, args };
}

/** Per-parameter problems with a custom case (null = fine). */
export function caseErrors(signature: Signature, c: CustomCase, language: SupportedLanguage): (string | null)[] {
  return signature.params.map((p, i) => {
    const parsed = parseArgText(c.args[i] ?? '');
    if (!parsed.ok) return parsed.error;
    return conformanceError(p.type, parsed.value, language);
  });
}

/** Custom cases → argument lists, or the index of the first broken case. */
export function customInputs(signature: Signature, cases: CustomCase[], language: SupportedLanguage): { ok: true; inputs: unknown[][] } | { ok: false; index: number } {
  const inputs: unknown[][] = [];
  for (let i = 0; i < cases.length; i++) {
    if (caseErrors(signature, cases[i], language).some(Boolean)) return { ok: false, index: i };
    inputs.push(cases[i].args.map((a) => (parseArgText(a) as { ok: true; value: unknown }).value));
  }
  return { ok: true, inputs };
}

interface CasesPanelProps {
  signature: Signature;
  samples: SampleTest[];
  cases: CustomCase[];
  onCasesChange: (next: CustomCase[]) => void;
  /** Custom inputs can be judged (a reference solution exists). */
  allowCustom: boolean;
  /** False in build mode: a build run checks every test and there is no Submit. */
  canSubmit: boolean;
  language: SupportedLanguage;
  selected: string;
  onSelect: (key: string) => void;
}

/**
 * The run's test cases: the question's samples (read-only) and the
 * learner's own inputs, typed as JSON per parameter and checked against
 * the signature as they type. Expected values for custom cases come from
 * the reference solution when the run happens.
 */
export function CasesPanel({ signature, samples, cases, onCasesChange, allowCustom, canSubmit, language, selected, onSelect }: CasesPanelProps) {
  const tabsId = useId();
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const tabs = [
    ...samples.map((_, i) => ({ value: `s${i}`, label: `Sample ${i + 1}` })),
    ...cases.map((c, i) => ({ value: c.id, label: `Custom ${i + 1}` })),
  ];
  const current = tabs.some((t) => t.value === selected) ? selected : tabs[0]?.value ?? '';
  const sampleIdx = current.startsWith('s') && !cases.some((c) => c.id === current) ? Number(current.slice(1)) : -1;
  const sample = sampleIdx >= 0 ? samples[sampleIdx] : null;
  const custom = cases.find((c) => c.id === current) ?? null;
  const customIndex = custom ? cases.indexOf(custom) : -1;

  const add = () => {
    const source = custom?.args ?? (sample ? sample.input.map((v) => valueToText(v)) : signature.params.map(() => ''));
    const c = newCase([...source]);
    onCasesChange([...cases, c]);
    onSelect(c.id);
  };
  const remove = (id: string) => {
    const next = cases.filter((c) => c.id !== id);
    onCasesChange(next);
    onSelect(next.at(-1)?.id ?? 's0');
  };
  const update = (id: string, i: number, value: string) => {
    onCasesChange(cases.map((c) => (c.id === id ? { ...c, args: c.args.map((a, k) => (k === i ? value : a)) } : c)));
    setTouched((t) => new Set(t).add(`${id}:${i}`));
  };

  const errors = custom ? caseErrors(signature, custom, language) : [];

  return (
    <div className={s.cases} data-testid="cases-panel">
      <div className={s.caseBar}>
        <Tabs id={tabsId} tabs={tabs} value={current} onChange={onSelect} variant="pills" size="sm" aria-label="Test cases" />
        {allowCustom && (
          <Button size="xs" variant="ghost" icon="plus" onClick={add} disabled={cases.length >= MAX_CUSTOM_CASES} title={cases.length >= MAX_CUSTOM_CASES ? `Up to ${MAX_CUSTOM_CASES} custom cases` : undefined}>
            Add case
          </Button>
        )}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel-${current.replace(/[^a-zA-Z0-9_-]/g, '_')}`} aria-labelledby={`${tabsId}-tab-${current.replace(/[^a-zA-Z0-9_-]/g, '_')}`} className={s.caseBody}>
        {sample && (
          <dl className={s.caseFields}>
            {namedArgs(signature, sample.input).map((a, i) => (
              <div key={a.name} className={s.caseField}>
                <dt className={s.caseLabel}>
                  {a.name} <span className={s.caseType}>{signature.params[i]?.type}</span>
                </dt>
                <dd className={`${s.caseValue} mono`}>{formatValue(a.value)}</dd>
              </div>
            ))}
            <div className={s.caseField}>
              <dt className={s.caseLabel}>
                expected <span className={s.caseType}>{signature.returns}</span>
              </dt>
              <dd className={`${s.caseValue} mono`}>{formatValue(sample.expected)}</dd>
            </div>
          </dl>
        )}

        {custom && (
          <div className={s.caseFields}>
            {signature.params.map((p, i) => {
              const err = errors[i];
              const show = err && (touched.has(`${custom.id}:${i}`) || err !== 'empty');
              return (
                <Textarea
                  key={p.name}
                  label={
                    <>
                      {p.name} <span className={s.caseType}>{p.type}</span>
                    </>
                  }
                  value={custom.args[i] ?? ''}
                  onChange={(e) => update(custom.id, i, e.target.value)}
                  error={show ? (err === 'empty' ? 'Enter a value' : err) : undefined}
                  rows={1}
                  mono
                  autoCapitalize="off"
                  autoCorrect="off"
                  full
                  textareaStyle={{ minHeight: 34, fontSize: 12.5 }}
                  data-testid={`custom-arg-${i}`}
                />
              );
            })}
            <div className={s.caseFoot}>
              <span className={s.caseHint}>
                <Icon name="info" size={12} /> JSON values. The expected output comes from the reference solution.
              </span>
              <Button size="xs" variant="ghost" icon="trash" onClick={() => remove(custom.id)} aria-label={`Remove custom case ${customIndex + 1}`}>
                Remove
              </Button>
            </div>
          </div>
        )}

        {!sample && !custom && (
          <p className={s.caseHint}>
            {allowCustom ? 'Add a case to run your code on your own input.' : 'No sample cases for this problem.'}
          </p>
        )}
        {!allowCustom && sample && (
          <p className={s.caseHint}>
            <Icon name="info" size={12} /> {canSubmit ? 'Runs check the samples; Submit checks the hidden tests too.' : 'A build run checks every test, hidden ones included.'}
          </p>
        )}
      </div>
    </div>
  );
}
