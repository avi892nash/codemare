'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/states/EmptyState';
import { VerdictText } from '@/components/Results/VerdictText';
import { formatKb, formatMicros, formatPercent, text, timeAgo } from '@/lib/client/format';
import { languageLabel } from '@/lib/client/languages';
import type { SubmissionSummary } from './types';
import s from './Workspace.module.css';

/** The learner's recent submissions of this problem, newest first. */
export function SubmissionsList({ submissions }: { submissions: SubmissionSummary[] }) {
  if (submissions.length === 0) {
    return <EmptyState size="sm" icon="history" title="No submissions yet" description="Submit a solution and it shows up here with its runtime and memory." headingLevel={3} />;
  }
  return (
    <table className={s.subs} data-testid="submissions-list">
      <thead>
        <tr>
          <th scope="col">Status</th>
          <th scope="col">Language</th>
          <th scope="col" className={s.num}>
            Runtime
          </th>
          <th scope="col" className={s.num}>
            Memory
          </th>
          <th scope="col">When</th>
        </tr>
      </thead>
      <tbody>
        {submissions.map((sub) => {
          return (
            <tr key={sub.id}>
              <td>
                <Link href={`/submissions/${sub.id}`} className={`${s.subLink} focus-ring`} aria-label={`Open submission from ${timeAgo(sub.createdAt)}`}>
                  <VerdictText status={sub.status} />
                  {sub.kind === 'gate' && <span className={s.subKind}>gate</span>}
                </Link>
              </td>
              <td>{languageLabel(sub.language)}</td>
              <td className={`${s.num} mono`}>
                {text(formatMicros(sub.runtimeUs))}
                {sub.percentile != null && sub.status === 'OK' && (
                  <span className={s.subBeats} title={`Faster than ${formatPercent(sub.percentile)}% of other learners`}>
                    {' '}
                    · {formatPercent(sub.percentile)}%
                  </span>
                )}
              </td>
              <td className={`${s.num} mono`}>{text(formatKb(sub.memoryKb))}</td>
              <td className={s.subWhen}>
                <time dateTime={sub.createdAt}>{timeAgo(sub.createdAt)}</time>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
