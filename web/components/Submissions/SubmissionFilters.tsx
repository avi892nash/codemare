'use client';

import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { LANGUAGE_LABEL } from '@/components/ui/highlight';
import { useFilterNav, useSettledState } from '@/components/Filters/FilterNav';
import { LANGUAGES, VERDICTS, VERDICT_LABEL, type SubmissionKind, type SupportedLanguage } from '@/lib/types';
import {
  EMPTY_SUBMISSION_QUERY,
  SUBMISSION_KINDS,
  hasSubmissionFilters,
  submissionsHref,
  type SubmissionQuery,
  type SubmissionStatusFilter,
} from './query';
import s from './Submissions.module.css';

/** Status / language / kind selects. Each change is a URL change, made in a transition. */
export function SubmissionFilters({ query, total }: { query: SubmissionQuery; total: number }) {
  const { navigate, pending } = useFilterNav();
  const [local, setLocal, ref] = useSettledState(query, pending);

  const apply = (patch: Partial<SubmissionQuery>) => {
    const next = { ...ref.current, ...patch, page: 1 };
    setLocal(next);
    navigate(submissionsHref(next));
  };

  return (
    <div className={s.filters}>
      <Select
        className={s.select}
        size="sm"
        icon="check-circle"
        aria-label="Status"
        value={local.status ?? ''}
        onChange={(e) => apply({ status: (e.target.value || null) as SubmissionStatusFilter | null })}
      >
        <option value="">All statuses</option>
        {VERDICTS.map((v) => (
          <option key={v} value={v}>
            {VERDICT_LABEL[v]}
          </option>
        ))}
        <option value="pending">Pending</option>
      </Select>
      <Select
        className={s.select}
        size="sm"
        icon="code"
        aria-label="Language"
        value={local.language ?? ''}
        onChange={(e) => apply({ language: (e.target.value || null) as SupportedLanguage | null })}
      >
        <option value="">All languages</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {LANGUAGE_LABEL[l]}
          </option>
        ))}
      </Select>
      <Select
        className={s.select}
        size="sm"
        icon="layers"
        aria-label="Kind"
        value={local.kind ?? ''}
        onChange={(e) => apply({ kind: (e.target.value || null) as SubmissionKind | null })}
      >
        <option value="">All kinds</option>
        {SUBMISSION_KINDS.map((k) => (
          <option key={k} value={k}>
            {k[0].toUpperCase() + k.slice(1)}
          </option>
        ))}
      </Select>
      {hasSubmissionFilters(local) && (
        <Button variant="ghost" size="xs" icon="x" onClick={() => apply({ ...EMPTY_SUBMISSION_QUERY })}>
          Clear filters
        </Button>
      )}
      <p className={s.count} role="status">
        <span>
          <strong>{total}</strong> {total === 1 ? 'submission' : 'submissions'}
        </span>
        {pending && <Spinner size={12} label="Updating results" />}
      </p>
    </div>
  );
}
