'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import type { CompareMode, SignatureType } from '@/lib/types';
import { FieldProblem, ItemTools, keyOf, move, ProblemList, Section, withKey, type SectionProps } from '../kit';
import {
  draftSignature,
  emptyTest,
  formatJson,
  LANGUAGE_NAMES,
  LIMITS,
  MIN_HIDDEN_TESTS,
  parseArgs,
  parseExpected,
  parseType,
  testFitIssues,
  type ReferenceRun,
} from '../model';
import s from '../author.module.css';

function sampleValue(type: SignatureType): unknown {
  const t = parseType(type);
  if (!t) return 0;
  const scalar = { int: 3, long: 10, double: 1.5, bool: true, string: 'abc', char: 'a' }[t.base];
  if (t.dims === 1) return [scalar, scalar];
  if (t.dims === 2) return [[scalar], [scalar, scalar]];
  return scalar;
}

const rowsFor = (text: string) => Math.min(8, Math.max(1, text.split('\n').length, Math.ceil(text.length / 48)));

interface Props extends SectionProps {
  /** The newest reference run that still matches the draft (annotates each test). */
  freshRun: ReferenceRun | null;
  onFill: (indexes: number[]) => void;
}

export function TestsSection({ draft, update, checks, freshRun, onFill }: Props) {
  const baseId = useId();
  const sig = draftSignature(draft);
  const hidden = draft.tests.filter((t) => t.hidden).length;
  const visible = draft.tests.length - hidden;
  const argsPlaceholder = formatJson(draft.params.map((p) => sampleValue(p.type)));
  const expectedPlaceholder = formatJson(sampleValue(draft.returns));
  const countProblems = checks.tests.problems.filter((p) => !/^Test \d+:/.test(p));

  const addTest = (hiddenTest: boolean) => update((d) => ({ ...d, tests: [...d.tests, withKey(emptyTest(hiddenTest))] }));

  return (
    <Section
      id="tests"
      n={6}
      title="Tests"
      desc={`Arguments are a JSON array (one element per parameter); expected is any JSON value. Hidden tests only run on Submit — publish needs at least ${MIN_HIDDEN_TESTS}.`}
      done={checks.tests.ok}
      tools={
        <span className={s.count} aria-live="polite">
          {draft.tests.length} tests · {visible} visible · {hidden} hidden
        </span>
      }
    >
      <div className={s.settings}>
        <Select
          label="Compare outputs"
          value={draft.compareMode}
          onChange={(e) => update((d) => ({ ...d, compareMode: e.target.value as CompareMode }))}
          options={[
            { value: 'ordered', label: 'Exactly (ordered)' },
            { value: 'unordered', label: 'As a multiset (any order)' },
          ]}
          style={{ width: 230 }}
        />
        <Input
          label="Time limit (ms)"
          type="number"
          min={LIMITS.timeMs.min}
          max={LIMITS.timeMs.max}
          step={100}
          value={draft.timeLimitMs}
          style={{ width: 140 }}
          inputStyle={{ fontFamily: 'var(--font-mono)' }}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (Number.isFinite(v)) update((d) => ({ ...d, timeLimitMs: Math.min(LIMITS.timeMs.max, Math.max(LIMITS.timeMs.min, v)) }));
          }}
        />
        <Input
          label="Memory (MB)"
          type="number"
          min={LIMITS.memoryMb.min}
          max={LIMITS.memoryMb.max}
          step={16}
          value={draft.memoryLimitMb}
          style={{ width: 120 }}
          inputStyle={{ fontFamily: 'var(--font-mono)' }}
          onChange={(e) => {
            const v = Math.round(Number(e.target.value));
            if (Number.isFinite(v)) update((d) => ({ ...d, memoryLimitMb: Math.min(LIMITS.memoryMb.max, Math.max(LIMITS.memoryMb.min, v)) }));
          }}
        />
        <p className={s.help} style={{ flexBasis: '100%' }}>
          Unordered compares list outputs ignoring order (e.g. “return the pairs in any order”). Limits apply per run,
          CPU time.
        </p>
      </div>

      <ol className={s.items} aria-label="Tests">
        {draft.tests.map((t, i) => {
          const name = `test ${i + 1}`;
          const idBase = `${baseId}-t${i}`;
          const args = parseArgs(t.args);
          const exp = parseExpected(t.expected);
          const fit = args.ok && exp.ok ? testFitIssues(sig, args.input, exp.expected) : args.ok ? testFitIssues(sig, args.input, sampleValue(draft.returns)).filter((x) => !x.startsWith('expected')) : [];
          const argsError = t.args.trim() || t.expected.trim() ? (args.ok ? null : args.message) : null;
          const expError = t.args.trim() || t.expected.trim() ? (exp.ok ? null : exp.message) : null;
          const result = freshRun?.tests.find((r) => r.idx === i) ?? null;
          const set = (patch: Partial<typeof t>) =>
            update((d) => ({ ...d, tests: d.tests.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
          const invalid = !!(argsError || expError || fit.length);
          return (
            <li key={keyOf(t, i)} className={s.item} data-invalid={invalid || undefined}>
              <div className={s.itemHead}>
                <span className={s.itemTitle}>Test {i + 1}</span>
                {result &&
                  (result.expectedMissing ? (
                    <Pill tone="muted" size="xs" icon="info">no expected yet</Pill>
                  ) : result.passed ? (
                    <Pill tone="ok" size="xs" icon="check">passes</Pill>
                  ) : (
                    <Pill tone="err" size="xs" icon="x">{result.error ? 'error' : 'fails'}</Pill>
                  ))}
                <Switch
                  size="sm"
                  checked={t.hidden}
                  onChange={(v) => set({ hidden: v })}
                  label={
                    <>
                      <span className="sr-only">Test {i + 1} </span>Hidden
                    </>
                  }
                  style={{ marginLeft: 8 }}
                />
                <ItemTools
                  name={name}
                  index={i}
                  count={draft.tests.length}
                  onMove={(to) => update((d) => ({ ...d, tests: move(d.tests, i, to) }))}
                  onRemove={() => update((d) => ({ ...d, tests: d.tests.filter((_, j) => j !== i) }))}
                  extra={
                    <Button
                      variant="ghost"
                      size="xs"
                      icon="copy"
                      aria-label={`Duplicate ${name}`}
                      onClick={() =>
                        update((d) => ({ ...d, tests: [...d.tests.slice(0, i + 1), withKey({ ...t }), ...d.tests.slice(i + 1)] }))
                      }
                    />
                  }
                />
              </div>
              <div className={s.itemBody}>
                <div className={s.testGrid}>
                  <div className={s.fieldset}>
                    <label className={s.label} htmlFor={`${idBase}-args`}>
                      <span className="sr-only">Test {i + 1} </span>
                      Arguments <span className="mono" style={{ color: 'var(--fg-2)' }}>JSON array</span>
                    </label>
                    <textarea
                      id={`${idBase}-args`}
                      className={s.jsonArea}
                      rows={rowsFor(t.args)}
                      value={t.args}
                      placeholder={argsPlaceholder}
                      spellCheck={false}
                      aria-invalid={!!argsError || fit.some((f) => f.startsWith('has') || f.startsWith('argument')) || undefined}
                      aria-describedby={argsError ? `${idBase}-args-err` : undefined}
                      onChange={(e) => set({ args: e.target.value })}
                    />
                    {argsError && <FieldProblem id={`${idBase}-args-err`}>{argsError}</FieldProblem>}
                  </div>
                  <div className={s.fieldset}>
                    <label className={s.label} htmlFor={`${idBase}-exp`}>
                      <span className="sr-only">Test {i + 1} </span>
                      Expected <span className="mono" style={{ color: 'var(--fg-2)' }}>{draft.returns}</span>
                    </label>
                    <textarea
                      id={`${idBase}-exp`}
                      className={s.jsonArea}
                      rows={rowsFor(t.expected)}
                      value={t.expected}
                      placeholder={expectedPlaceholder}
                      spellCheck={false}
                      aria-invalid={!!expError || fit.some((f) => f.startsWith('expected')) || undefined}
                      aria-describedby={expError ? `${idBase}-exp-err` : undefined}
                      onChange={(e) => set({ expected: e.target.value })}
                    />
                    {expError && <FieldProblem id={`${idBase}-exp-err`}>{expError}</FieldProblem>}
                  </div>
                </div>
                {fit.map((f) => (
                  <FieldProblem key={f}>Doesn’t fit the signature: {f}</FieldProblem>
                ))}
                {result && result.hasActual && (result.expectedMissing || !result.passed) && freshRun && (
                  <div className={s.actualBox}>
                    <span>{LANGUAGE_NAMES[freshRun.language]} reference returned</span>
                    <code>{formatJson(result.actual)}</code>
                    <Button size="xs" variant="accent" icon="check" onClick={() => onFill([i])} style={{ marginLeft: 'auto' }}>
                      Use as expected
                    </Button>
                  </div>
                )}
                {result?.error && <p className={s.errText}>{result.error}</p>}
                <Input
                  label={
                    <>
                      <span className="sr-only">Test {i + 1} </span>Explain on fail (optional)
                    </>
                  }
                  full
                  maxLength={300}
                  value={t.explainOnFail}
                  placeholder="Shown to the learner when this test fails, e.g. “Empty input: return 0.”"
                  onChange={(e) => set({ explainOnFail: e.target.value })}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className={s.row}>
        <Button size="sm" icon="plus" onClick={() => addTest(false)}>
          Add visible test
        </Button>
        <Button size="sm" icon="eye-off" onClick={() => addTest(true)}>
          Add hidden test
        </Button>
      </div>
      <ProblemList problems={countProblems} />
    </Section>
  );
}
