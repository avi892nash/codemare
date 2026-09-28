'use client';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LangMark } from '@/components/ui/LangMark';
import { Select } from '@/components/ui/Select';
import type { SignatureType } from '@/lib/types';
import { ItemTools, keyOf, move, ProblemList, Section, withKey, type SectionProps } from '../kit';
import { draftSignature, identifierIssue, SIGNATURE_TYPES, signaturePreview } from '../model';
import s from '../author.module.css';

const TYPE_OPTIONS = SIGNATURE_TYPES.map((t) => ({ value: t, label: t }));
const PREVIEWS = [
  ['cpp', 'C++'],
  ['java', 'Java'],
  ['go', 'Go'],
  ['typescript', 'TypeScript'],
] as const;

/** A fresh parameter name that is not taken yet. */
function nextParamName(taken: string[]): string {
  for (const base of ['nums', 'target', 'k', 's', 't', 'grid', 'n', 'x', 'y']) if (!taken.includes(base)) return base;
  let i = taken.length + 1;
  while (taken.includes(`arg${i}`)) i++;
  return `arg${i}`;
}

export function SignatureSection({ draft, update, checks }: SectionProps) {
  const sig = draftSignature(draft);
  const fnIssue = draft.functionName ? identifierIssue(draft.functionName, 'The function name') : null;
  // Identifier problems show inline; the rest (test fit) list below the previews.
  const other = checks.signature.problems.filter((p) => !/^(Function name|Parameter \d)/.test(p));

  return (
    <Section
      id="signature"
      n={4}
      title="Signature"
      desc="Typed parameters and return value. C++, Java and Go harnesses are generated from it, so every test must fit these types."
      done={checks.signature.ok}
    >
      <Input
        label="Function name"
        required
        value={draft.functionName}
        placeholder="twoSum"
        maxLength={40}
        inputStyle={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
        style={{ maxWidth: 360 }}
        error={fnIssue ?? undefined}
        hint="Legal in all six languages; learners implement exactly this function."
        onChange={(e) => {
          const functionName = e.target.value.trim();
          update((d) => ({ ...d, functionName }));
        }}
      />

      <fieldset className={s.fieldset}>
        <legend className={s.label}>Parameters</legend>
        <ol className={s.items} aria-label="Parameters">
          {draft.params.map((p, i) => {
            const issue = identifierIssue(p.name, `Parameter ${i + 1}`);
            const dup = draft.params.findIndex((q) => q.name === p.name) !== i;
            return (
              <li key={keyOf(p, i)} className={s.paramRow}>
                <span className={s.paramIdx} aria-hidden="true">
                  {i + 1}
                </span>
                <Input
                  aria-label={`Parameter ${i + 1} name`}
                  value={p.name}
                  full
                  inputStyle={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                  error={p.name ? (issue ?? (dup ? `"${p.name}" is used twice` : undefined)) : 'Name the parameter'}
                  onChange={(e) => {
                    const name = e.target.value.trim();
                    update((d) => ({ ...d, params: d.params.map((x, j) => (j === i ? { ...x, name } : x)) }));
                  }}
                />
                <Select
                  aria-label={`Parameter ${i + 1} type`}
                  value={p.type}
                  full
                  options={TYPE_OPTIONS}
                  onChange={(e) => {
                    const type = e.target.value as SignatureType;
                    update((d) => ({ ...d, params: d.params.map((x, j) => (j === i ? { ...x, type } : x)) }));
                  }}
                />
                <ItemTools
                  name={`parameter ${p.name || i + 1}`}
                  index={i}
                  count={draft.params.length}
                  onMove={(to) => update((d) => ({ ...d, params: move(d.params, i, to) }))}
                  onRemove={() => update((d) => ({ ...d, params: d.params.filter((_, j) => j !== i) }))}
                />
              </li>
            );
          })}
        </ol>
        <div className={s.row}>
          <Button
            size="sm"
            icon="plus"
            disabled={draft.params.length >= 12}
            onClick={() =>
              update((d) => ({
                ...d,
                params: [...d.params, withKey({ name: nextParamName(d.params.map((x) => x.name)), type: 'int' as SignatureType })],
              }))
            }
          >
            Add parameter
          </Button>
          {draft.params.length === 0 && <span className={s.help}>No parameters: the function takes no arguments.</span>}
        </div>
      </fieldset>

      <Select
        label="Returns"
        value={draft.returns}
        options={TYPE_OPTIONS}
        style={{ width: 180 }}
        onChange={(e) => update((d) => ({ ...d, returns: e.target.value as SignatureType }))}
      />

      <div className={s.fieldset}>
        <span className={s.caps}>Generated signatures</span>
        <div className={`${s.previewBox} scroll`} tabIndex={0} role="region" aria-label="Signature in C++, Java, Go and TypeScript">
          {PREVIEWS.map(([lang, name]) => (
            <div key={lang} className={s.previewLine}>
              <LangMark lang={lang} size={12} />
              <span className="sr-only">{name}:</span>
              <code>{signaturePreview(lang, draft.functionName, sig)}</code>
            </div>
          ))}
        </div>
      </div>
      <ProblemList problems={other} max={5} />
    </Section>
  );
}
