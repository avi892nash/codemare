'use client';

import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { ItemTools, keyOf, move, ProblemList, Section, withKey, type SectionProps } from '../kit';
import { MarkdownField } from '../MarkdownField';
import { parseTest } from '../model';
import s from '../author.module.css';

export function StatementSection({ draft, update, checks }: SectionProps) {
  const statementProblems = checks.statement.problems.filter((p) => !/example/i.test(p));
  return (
    <Section
      id="statement"
      n={2}
      title="Statement"
      desc="Markdown (GitHub-flavored). The preview renders through the same sanitizer learners see."
      done={checks.statement.ok}
    >
      <MarkdownField
        label="Problem statement"
        required
        value={draft.statementMd}
        onChange={(statementMd) => update((d) => ({ ...d, statementMd }))}
        placeholder={'Given an array of integers `nums` and an integer `target`, return …'}
        rows={12}
        error={draft.statementMd && statementProblems.length ? statementProblems[0] : null}
      />
      <Textarea
        label="Constraints"
        hint="One per line, e.g. 1 <= nums.length <= 10^4"
        mono
        rows={4}
        value={draft.constraints.join('\n')}
        onChange={(e) => {
          const constraints = e.target.value.split('\n');
          update((d) => ({ ...d, constraints }));
        }}
      />
    </Section>
  );
}

/** "nums = [2,7,11,15], target = 9" from the first valid visible test. */
function exampleFromTests(draft: SectionProps['draft']) {
  for (const t of draft.tests) {
    if (t.hidden) continue;
    const p = parseTest(t);
    if (!p.ok || p.input.length !== draft.params.length) continue;
    return {
      input: draft.params.map((param, i) => `${param.name} = ${JSON.stringify(p.input[i])}`).join(', '),
      output: JSON.stringify(p.expected),
      explanation: '',
    };
  }
  return null;
}

export function ExamplesSection({ draft, update, checks }: SectionProps) {
  const fromTest = exampleFromTests(draft);
  const exampleProblems = checks.statement.problems.filter((p) => /example/i.test(p));
  return (
    <Section
      id="examples"
      n={3}
      title="Examples"
      desc="Shown under the statement. Plain text — write inputs the way learners read them."
      done={exampleProblems.length === 0 && draft.examples.length > 0}
      tools={
        <Button
          variant="ghost"
          size="sm"
          icon="copy"
          disabled={!fromTest}
          title={fromTest ? undefined : 'Needs a visible test that fits the signature'}
          onClick={() => fromTest && update((d) => ({ ...d, examples: [...d.examples, withKey(fromTest)] }))}
        >
          From first visible test
        </Button>
      }
    >
      <ol className={s.items}>
        {draft.examples.map((ex, i) => {
          const name = `example ${i + 1}`;
          const set = (patch: Partial<typeof ex>) =>
            update((d) => ({ ...d, examples: d.examples.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
          return (
            <li key={keyOf(ex, i)} className={s.item}>
              <div className={s.itemHead}>
                <span className={s.itemTitle}>Example {i + 1}</span>
                <ItemTools
                  name={name}
                  index={i}
                  count={draft.examples.length}
                  onMove={(to) => update((d) => ({ ...d, examples: move(d.examples, i, to) }))}
                  onRemove={() => update((d) => ({ ...d, examples: d.examples.filter((_, j) => j !== i) }))}
                />
              </div>
              <div className={s.itemBody}>
                <div className={s.grid2}>
                  <Textarea
                    label="Input"
                    mono
                    rows={2}
                    value={ex.input}
                    placeholder="nums = [2,7,11,15], target = 9"
                    onChange={(e) => set({ input: e.target.value })}
                  />
                  <Textarea
                    label="Output"
                    mono
                    rows={2}
                    value={ex.output}
                    placeholder="[0,1]"
                    onChange={(e) => set({ output: e.target.value })}
                  />
                </div>
                <Textarea
                  label="Explanation (optional)"
                  rows={2}
                  value={ex.explanation}
                  placeholder="Because nums[0] + nums[1] == 9, we return [0, 1]."
                  onChange={(e) => set({ explanation: e.target.value })}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className={s.row}>
        <Button
          size="sm"
          icon="plus"
          onClick={() => update((d) => ({ ...d, examples: [...d.examples, withKey({ input: '', output: '', explanation: '' })] }))}
        >
          Add example
        </Button>
      </div>
      <ProblemList problems={exampleProblems} />
    </Section>
  );
}
