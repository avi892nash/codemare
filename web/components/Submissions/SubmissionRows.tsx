import Link from 'next/link';
import { VerdictText } from '@/components/Results/VerdictText';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { LangMark } from '@/components/ui/LangMark';
import { LANGUAGE_LABEL } from '@/components/ui/highlight';
import type { SubmissionListRow, SubmissionSubject } from '@/lib/server/submissionHistory';
import type { SubmissionKind } from '@/lib/types';
import { fmtAbsolute, fmtKb, fmtMicros, fmtRelative } from './format';
import s from './Submissions.module.css';

export function subjectTitle(subject: SubmissionSubject): string {
  return subject.type === 'question' ? subject.title : 'Deleted problem';
}

/** What a submission was: a run (samples), a submit (judged against every test) or a gate attempt's submit. */
export const KIND_LABEL: Record<SubmissionKind, string> = { run: 'Run', submit: 'Submit', gate: 'Gate' };

/** Visual column titles, in sentence case (rows carry their own screen-reader labels). */
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
              <VerdictText status={r.status} kind={r.kind} />
            </span>
            <span className={s.cTitle}>
              <span className={s.titleText}>{subjectTitle(r.subject)}</span>
              {r.subject.type === 'question' && <DifficultyText level={r.subject.difficulty} />}
            </span>
            <span className={s.cLang}>
              <LangMark lang={r.language} />
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
              <span className={s.label}>Kind </span>
              {KIND_LABEL[r.kind]}
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
