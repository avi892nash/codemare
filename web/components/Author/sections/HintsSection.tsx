'use client';

import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DEFAULT_HINT_SCORE_COST, HINT_LEVELS, type HintCostKind, type HintLevel } from '@/lib/types';
import { ProblemList, Section, type SectionProps } from '../kit';
import { HINT_LEVEL_LABEL, type DraftHint } from '../model';
import { MarkdownField } from '../MarkdownField';
import s from '../author.module.css';

const PURPOSE: Record<HintLevel, string> = {
  nudge: 'A question that points the right way.',
  concept: 'The idea or data structure that cracks it.',
  pseudo: 'The algorithm in pseudocode.',
  line: 'The one line that matters most.',
  solution: 'A complete, explained solution.',
};

/** Score penalty (%) after revealing rungs 0..i — score costs add up (spec §3.2, capped at 100). */
function cumulative(hints: DraftHint[], i: number): number {
  return HINT_LEVELS.slice(0, i + 1).reduce((n, level) => {
    const h = hints.find((x) => x.level === level);
    return h && h.costKind === 'score' ? n + h.costAmount : n;
  }, 0);
}

export function HintsSection({ draft, update, checks }: SectionProps) {
  const set = (level: HintLevel, patch: Partial<DraftHint>) =>
    update((d) => ({ ...d, hints: d.hints.map((h) => (h.level === level ? { ...h, ...patch } : h)) }));

  return (
    <Section
      id="hints"
      n={8}
      title="Hint ladder"
      desc="Five rungs, revealed in order. Learners see each cost before they reveal it: a score penalty (% off the solve award) or tokens."
      done={checks.hints.ok}
    >
      <ol className={s.items}>
        {HINT_LEVELS.map((level, i) => {
          const h = draft.hints.find((x) => x.level === level)!;
          const score = h.costKind === 'score';
          const costError =
            !Number.isInteger(h.costAmount) || h.costAmount < 0
              ? 'Whole number ≥ 0'
              : score && h.costAmount > 100
                ? 'A percentage: 0–100'
                : undefined;
          return (
            <li key={level} className={s.hintRow}>
              <div className={s.hintLevel}>
                <span className={s.hintStep}>
                  {i + 1}/{HINT_LEVELS.length}
                </span>
                <span className={s.hintName}>{HINT_LEVEL_LABEL[level]}</span>
                <span className={s.help}>{PURPOSE[level]}</span>
              </div>
              <div className={s.fieldset} style={{ gap: 10 }}>
                <MarkdownField
                  layout="tabs"
                  label={`${HINT_LEVEL_LABEL[level]} hint`}
                  rows={level === 'solution' || level === 'pseudo' ? 6 : 3}
                  value={h.bodyMd}
                  onChange={(bodyMd) => set(level, { bodyMd })}
                />
                <div className={s.hintCost}>
                  <Select
                    label="Cost"
                    size="sm"
                    value={h.costKind}
                    options={[
                      { value: 'score', label: 'Score penalty' },
                      { value: 'token', label: 'Tokens' },
                    ]}
                    onChange={(e) => {
                      const costKind = e.target.value as HintCostKind;
                      set(level, {
                        costKind,
                        costAmount: costKind === 'score' ? DEFAULT_HINT_SCORE_COST[level] : Math.max(1, Math.min(5, i)),
                      });
                    }}
                    style={{ width: 160 }}
                  />
                  <Input
                    aria-label={`${HINT_LEVEL_LABEL[level]} hint cost ${score ? 'in percent' : 'in tokens'}`}
                    size="sm"
                    type="number"
                    min={0}
                    max={score ? 100 : 1000}
                    step={score ? 5 : 1}
                    value={h.costAmount}
                    error={costError}
                    style={{ width: 120 }}
                    inputStyle={{ fontFamily: 'var(--font-mono)' }}
                    trailing={<span className={s.help}>{score ? '%' : 'tokens'}</span>}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set(level, { costAmount: e.target.value === '' || !Number.isFinite(n) ? 0 : Math.max(0, Math.round(n)) });
                    }}
                  />
                  <span className={s.help} style={{ paddingBottom: 7 }}>
                    {score
                      ? h.costAmount === 0
                        ? 'Free to reveal'
                        : `${Math.min(100, cumulative(draft.hints, i))}% off the award once rungs 1–${i + 1} are revealed`
                      : 'Spent from the question’s highest-weight topic'}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <ProblemList problems={checks.hints.problems} max={5} />
    </Section>
  );
}

export function EditorialSection({ draft, update }: SectionProps) {
  return (
    <Section
      id="editorial"
      n={9}
      title="Editorial"
      desc="Optional. The worked explanation learners can open after solving: intuition, algorithm, complexity."
    >
      <MarkdownField
        label="Editorial"
        value={draft.editorialMd}
        onChange={(editorialMd) => update((d) => ({ ...d, editorialMd }))}
        placeholder={'### Intuition\n…\n\n### Algorithm\n…\n\n### Complexity\nO(n) time, O(n) space.'}
        rows={14}
      />
    </Section>
  );
}
