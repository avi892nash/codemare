'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DIFFICULTIES, type Difficulty } from '@/lib/types';
import { FieldProblem, Section, type SectionProps } from '../kit';
import { normalizeCompany, normalizeTag, slugify, SLUG_MAX, SLUG_RE } from '../model';
import { TagInput } from '../TagInput';
import s from '../author.module.css';

export interface TopicOption {
  slug: string;
  title: string;
  tier: string;
  tierOrd: number;
}

interface Props extends SectionProps {
  topics: TopicOption[];
  suggestions: { tags: string[]; companies: string[] };
  /** The slug follows the title until the author edits it. */
  slugLinked: boolean;
  onSlugLinked: (linked: boolean) => void;
  /** Published questions keep their slug. */
  slugLocked: boolean;
  slugError?: string | null;
}

export function BasicsSection({ draft, update, checks, topics, suggestions, slugLinked, onSlugLinked, slugLocked, slugError }: Props) {
  const topicSelectId = useId();
  const byTier = new Map<string, TopicOption[]>();
  for (const t of topics) byTier.set(t.tier, [...(byTier.get(t.tier) ?? []), t]);
  const chosen = new Set(draft.topics.map((t) => t.slug));
  const slugProblem =
    slugError ??
    (draft.slug && (!SLUG_RE.test(draft.slug) || draft.slug.length > SLUG_MAX)
      ? 'Use lowercase letters, digits and single dashes'
      : null);

  return (
    <Section
      id="basics"
      n={1}
      title="Basics"
      desc="What the question is called, where it lives, how hard it is and which topics it pays tokens into."
      done={checks.basics.ok}
    >
      <div className={s.grid2}>
        <Input
          label="Title"
          required
          full
          value={draft.title}
          maxLength={120}
          placeholder="e.g. Two Sum"
          onChange={(e) => {
            const title = e.target.value;
            update((d) => ({ ...d, title, slug: slugLinked && !slugLocked ? slugify(title) : d.slug }));
          }}
        />
        <Input
          label="Slug"
          required
          full
          value={draft.slug}
          readOnly={slugLocked}
          maxLength={SLUG_MAX}
          inputStyle={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
          placeholder="two-sum"
          error={slugProblem ?? undefined}
          hint={
            slugLocked
              ? 'Published questions keep their slug — links point at it.'
              : `Learners find it at /problems/${draft.slug || '…'}${slugLinked ? ' · follows the title' : ''}`
          }
          onChange={(e) => {
            onSlugLinked(false);
            const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');
            update((d) => ({ ...d, slug }));
          }}
          trailing={
            !slugLinked && !slugLocked ? (
              <Button
                variant="ghost"
                size="xs"
                icon="refresh"
                aria-label="Derive the slug from the title again"
                title="Derive from title"
                onClick={() => {
                  onSlugLinked(true);
                  update((d) => ({ ...d, slug: slugify(d.title) }));
                }}
              />
            ) : undefined
          }
        />
      </div>

      <div className={s.rowTop}>
        <Select
          label="Difficulty"
          value={draft.difficulty}
          options={DIFFICULTIES.map((d) => ({ value: d, label: d }))}
          onChange={(e) => update((d) => ({ ...d, difficulty: e.target.value as Difficulty }))}
          style={{ width: 180 }}
        />
        <div style={{ paddingTop: 26 }}>
          <DifficultyPill level={draft.difficulty} />
        </div>
      </div>

      <fieldset className={s.fieldset}>
        <legend className={s.label}>
          Topics <span aria-hidden="true" style={{ color: 'var(--err-fg)' }}>*</span>
        </legend>
        {draft.topics.length > 0 && (
          <ul className={s.items} aria-label="Chosen topics">
            {draft.topics.map((t, i) => {
              const meta = topics.find((o) => o.slug === t.slug);
              const weightId = `${topicSelectId}-w-${t.slug}`;
              return (
                <li key={t.slug} className={s.topicRow}>
                  <span className={s.topicName}>
                    {meta?.title ?? t.slug}
                    <span className={s.topicTier}>{meta ? meta.tier : 'unknown topic'}</span>
                  </span>
                  <span className={s.weight}>
                    <label htmlFor={weightId} className="sr-only">
                      Weight of {meta?.title ?? t.slug}
                    </label>
                    <input
                      id={weightId}
                      type="range"
                      className={s.range}
                      min={0.1}
                      max={3}
                      step={0.1}
                      value={t.weight}
                      onChange={(e) => {
                        const weight = Math.round(Number(e.target.value) * 10) / 10;
                        update((d) => ({ ...d, topics: d.topics.map((x, j) => (j === i ? { ...x, weight } : x)) }));
                      }}
                    />
                    <span className="mono" style={{ fontSize: 12, color: 'var(--fg-1)', width: 30, textAlign: 'right' }}>
                      ×{t.weight.toFixed(1)}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    icon="x"
                    aria-label={`Remove topic ${meta?.title ?? t.slug}`}
                    onClick={() => update((d) => ({ ...d, topics: d.topics.filter((_, j) => j !== i) }))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <Select
          id={topicSelectId}
          aria-label="Add a topic"
          value=""
          icon="plus"
          style={{ maxWidth: 360 }}
          onChange={(e) => {
            const slug = e.target.value;
            if (slug) update((d) => ({ ...d, topics: [...d.topics, { slug, weight: 1 }] }));
          }}
        >
          <option value="" disabled>
            {draft.topics.length ? 'Add another topic…' : 'Add a topic…'}
          </option>
          {[...byTier.entries()].map(([tier, list]) => (
            <optgroup key={tier} label={tier}>
              {list.map((t) => (
                <option key={t.slug} value={t.slug} disabled={chosen.has(t.slug)}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <p className={s.help}>
          A first accepted solve pays each topic <span className="mono">base × weight</span> tokens. Several topics make a
          composite question.
        </p>
        {!checks.basics.ok && draft.topics.length === 0 && draft.title && <FieldProblem>Pick at least one topic</FieldProblem>}
      </fieldset>

      <div className={s.grid2}>
        <TagInput
          label="Tags"
          values={draft.tags}
          onChange={(tags) => update((d) => ({ ...d, tags }))}
          normalize={normalizeTag}
          placeholder="hash-table, two-pointers…"
          hint="Enter or comma to add. Stored in kebab-case."
          suggestions={suggestions.tags}
        />
        <TagInput
          label="Companies"
          values={draft.companies}
          onChange={(companies) => update((d) => ({ ...d, companies }))}
          normalize={normalizeCompany}
          placeholder="Google, Amazon…"
          hint="Where this question has been asked."
          suggestions={suggestions.companies}
        />
      </div>
    </Section>
  );
}
