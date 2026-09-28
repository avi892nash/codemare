'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { CheckItem, CheckKey, QuestionDraft, SectionId } from './model';
import s from './author.module.css';

/** What every editor section receives. */
export interface SectionProps {
  draft: QuestionDraft;
  update: (fn: (d: QuestionDraft) => QuestionDraft) => void;
  checks: Record<CheckKey, CheckItem>;
}

// ─── Stable React keys for reorderable lists ─────────────────────────────
// Items carry a client-only `_k`; it never reaches the server (stripKeys)
// and never enters a fingerprint (model.ts reads named fields only).

let counter = 0;
export function withKey<T extends object>(item: T): T {
  return Object.assign({}, item, { _k: `k${++counter}` });
}
export function keyOf(item: object, fallback: number): string {
  return (item as { _k?: string })._k ?? `i${fallback}`;
}
export function withKeys(d: QuestionDraft): QuestionDraft {
  return {
    ...d,
    params: d.params.map(withKey),
    examples: d.examples.map(withKey),
    tests: d.tests.map(withKey),
    topics: d.topics.map(withKey),
  };
}
/** The draft without client-only keys — what server actions receive. */
export function stripKeys(d: QuestionDraft): QuestionDraft {
  return JSON.parse(JSON.stringify(d, (k, v) => (k === '_k' ? undefined : v)));
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

// ─── Section frame ───────────────────────────────────────────────────────

export function sectionDomId(id: SectionId) {
  return `sec-${id}`;
}

export function Section({
  id, n, title, desc, done, tools, children,
}: {
  id: SectionId;
  n: number;
  title: string;
  desc?: ReactNode;
  /** true → checklist items for this section pass; undefined → no requirement. */
  done?: boolean;
  tools?: ReactNode;
  children: ReactNode;
}) {
  const hid = `${sectionDomId(id)}-title`;
  return (
    <section id={sectionDomId(id)} className={s.section} aria-labelledby={hid}>
      <div className={s.sectionHead}>
        <span className={s.sectionNum} data-state={done ? 'ok' : 'todo'} aria-hidden="true">
          {done ? <Icon name="check" size={12} /> : n}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 id={hid} className={s.sectionTitle}>
            {title}
            {done !== undefined && <span className="sr-only">{done ? ' (complete)' : ' (needs work)'}</span>}
          </h2>
          {desc && <p className={s.sectionDesc}>{desc}</p>}
        </div>
        {tools && <div className={s.sectionTools}>{tools}</div>}
      </div>
      <div className={s.sectionBody}>{children}</div>
    </section>
  );
}

/** Move up / move down / remove for one list item, labelled with the item's name. */
export function ItemTools({
  name, index, count, onMove, onRemove, extra, removeDisabled,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  extra?: ReactNode;
  removeDisabled?: boolean;
}) {
  return (
    <div className={s.itemTools}>
      {extra}
      <Button variant="ghost" size="xs" icon="chev-up" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)} />
      <Button
        variant="ghost"
        size="xs"
        icon="chev-down"
        aria-label={`Move ${name} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      />
      <Button variant="ghost" size="xs" icon="trash" aria-label={`Remove ${name}`} disabled={removeDisabled} onClick={onRemove} />
    </div>
  );
}

export function FieldProblem({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className={s.error}>
      <Icon name="alert-circle" size={12} />
      <span>{children}</span>
    </p>
  );
}

/** Up to `max` problems, then "+N more". */
export function ProblemList({ problems, max = 4 }: { problems: string[]; max?: number }) {
  if (problems.length === 0) return null;
  return (
    <ul className={s.problems}>
      {problems.slice(0, max).map((p, i) => (
        <li key={i}>{p}</li>
      ))}
      {problems.length > max && <li className={s.problemMore}>+{problems.length - max} more</li>}
    </ul>
  );
}
