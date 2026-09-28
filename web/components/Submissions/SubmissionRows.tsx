import Link from 'next/link';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { LangMark } from '@/components/ui/LangMark';
import { Pill } from '@/components/ui/Pill';
import { LANGUAGE_LABEL } from '@/components/ui/highlight';
import type { SubmissionListRow, SubmissionSubject } from '@/lib/server/submissionHistory';
import { fmtAbsolute, fmtKb, fmtMicros, fmtRelative } from './format';
import { SubmissionStatus } from './SubmissionStatus';
import s from './Submissions.module.css';

export function subjectTitle(subject: SubmissionSubject): string {
  if (subject.type === 'question') return subject.title;
  if (subject.type === 'build') return subject.componentTitle;
  return 'Deleted problem';
}

/** Visual column titles (rows carry their own screen-reader labels). */
export function SubmissionColumnHead() {
  return (
    <div className={s.colHead} aria-hidden="true">
      <span>Status</span>
      <span>Problem</span>
      <span>Language</span>
      <span>Runtime</span>
      <span className={s.cMem}>Memory</span>
      <span className={s.cKind}>Kind</span>
      <span style={{ textAlign: 'right' }}>When</span>
    </div>
  );
}

function Metric({ value }: { value: [string, string] }) {
  return (
    <span className={s.num}>
      {value[0]}
      {value[1] && <span className={s.unit}> {value[1]}</span>}
    </span>
  );
}

/** Newest-first history rows; each opens /submissions/[id]. Server component. */
export function SubmissionRows({ rows, now }: { rows: SubmissionListRow[]; now: Date }) {
  return (
    <ol className={s.rows} aria-label="Submissions">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/submissions/${r.id}`} className={s.row}>
            <span className={s.cStatus}>
              <SubmissionStatus status={r.status} size="sm" />
            </span>
            <span className={s.cTitle}>
              <span className={s.titleText}>
                {subjectTitle(r.subject)}
                {r.subject.type === 'build' && <span className={s.subtle}> · {r.subject.stepTitle}</span>}
              </span>
              {r.subject.type === 'question' && <DifficultyPill level={r.subject.difficulty} size="xs" />}
            </span>
            <span className={s.cLang}>
              <LangMark lang={r.language} size={13} />
              {LANGUAGE_LABEL[r.language]}
            </span>
            <span className={s.cTime}>
              <span className={s.label}>Runtime </span>
              <Metric value={fmtMicros(r.runtimeUs)} />
            </span>
            <span className={s.cMem}>
              <span className={s.label}>Memory </span>
              <Metric value={fmtKb(r.memoryKb)} />
            </span>
            <span className={s.cKind}>
              <Pill tone="muted" size="xs" className="mono">
                {r.kind}
              </Pill>
            </span>
            <span className={s.cWhen}>
              <time dateTime={r.createdAt.toISOString()} title={fmtAbsolute(r.createdAt)}>
                {fmtRelative(r.createdAt, now)}
              </time>
            </span>
            <span className={s.break} aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
