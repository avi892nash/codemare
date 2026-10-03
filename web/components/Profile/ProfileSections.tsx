import Link from 'next/link';
import type { ReactNode } from 'react';
import { BadgeStrip } from '@/components/Badges/BadgeStrip';
import { EmptyState } from '@/components/states/EmptyState';
import { Avatar } from '@/components/ui/Avatar';
import { ButtonLink } from '@/components/ui/Button';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { PageHeader } from '@/components/ui/PageHeader';
import { Progress } from '@/components/ui/Progress';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { formatMicros, timeAgo } from '@/lib/client/format';
import { verdictTitle } from '@/lib/client/resultCopy';
import type { ProfileView } from '@/lib/server/profile';
import type { Difficulty, Role, SubmissionKind, SubmissionStatus, TrackLevel, Verdict } from '@/lib/types';
import s from './profile.module.css';

const LANG_LABEL: Record<string, string> = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', java: 'Java', go: 'Go' };
const ROLE_LABEL: Record<Role, string> = { learner: 'Learner', author: 'Author', staff: 'Staff', admin: 'Admin' };
const LEVEL_LABEL: Record<TrackLevel, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const DIFFS: Difficulty[] = ['Easy', 'Medium', 'Hard'];

const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** Between the parts of a context line; the break falls after the dot, never before it. */
const Dot = () => <span aria-hidden="true">{' · '}</span>;

/**
 * The identity: an avatar beside the shared page header — the name as the
 * title, one line under it (the handle when it differs from the name, when the
 * learner joined, a role, and whether this is the viewer's own page).
 */
export function ProfileHeader({ view }: { view: ProfileView }) {
  const { user } = view;
  const showHandle = user.name.trim().toLowerCase() !== user.handle;
  const role = user.role !== 'learner' ? ROLE_LABEL[user.role] : null;
  return (
    <div className={s.identity}>
      <Avatar name={user.name} src={user.image} size={50} />
      <PageHeader
        title={user.name}
        subtitle={
          <>
            {showHandle && (
              <>
                <span className={`${s.seg} mono`}>@{user.handle}</span>
                <Dot />
              </>
            )}
            <span className={s.seg}>Joined {fmtMonth(user.joinedAt)}</span>
            {role && (
              <>
                <Dot />
                <span className={s.seg}>{role}</span>
              </>
            )}
            {view.isOwner && (
              <>
                <Dot />
                <span className={s.seg}>This is you</span>
              </>
            )}
          </>
        }
      />
    </div>
  );
}

/** A card with a title and, at the right, a quiet note and/or a link. */
export function Panel({ title, id, note, action, children }: { title: string; id: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.card} aria-labelledby={id}>
      <div className={s.head}>
        <h2 className={s.title} id={id}>
          {title}
        </h2>
        {(note || action) && (
          <div className={s.headEnd}>
            {note && <span className={s.note}>{note}</span>}
            {action}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${s.link} focus-ring`}>
      {children} <Icon name="arrow-right" size={12} />
    </Link>
  );
}

/**
 * Three numbers a learner preparing looks at — solved (with Easy · Medium ·
 * Hard), the streak, tokens — and the rest (acceptance, fastest run) one click
 * away. A number that is 0 is not shown; a learner with nothing solved has no
 * stats card at all (the page says so once, under Recent submissions).
 */
export function StatsCard({ view }: { view: ProfileView }) {
  const { solved, acceptance, fastest, streak, tokens } = view;
  const published = solved.published.Easy + solved.published.Medium + solved.published.Hard;
  const fast = fastest ? formatMicros(fastest.runtimeUs) : null;
  const streakDays = streak.current > 0 ? streak.current : streak.longest;
  return (
    <section className={s.card} aria-label="Stats">
      <dl className={s.figures}>
        <div className={s.figure}>
          <dt className={s.figLabel}>Solved</dt>
          <dd className={s.figValue}>
            <span className={`${s.num} mono`}>{solved.total}</span>
            <span className={s.unit}>of {published}</span>
          </dd>
          <dd>
            <ul className={s.levels} aria-label="Solved by difficulty">
              {DIFFS.map((d) => (
                <li key={d}>
                  <DifficultyText level={d} />
                  <span className="mono">
                    {solved.byDifficulty[d]}/{solved.published[d]}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {streakDays > 0 && (
          <div className={s.figure}>
            <dt className={s.figLabel}>{streak.current > 0 ? 'Streak' : 'Longest streak'}</dt>
            <dd className={s.figValue}>
              <span className={`${s.num} mono`}>{streakDays}</span>
              <span className={s.unit}>day{streakDays === 1 ? '' : 's'}</span>
            </dd>
            {streak.current > 0 && <dd className={s.figSub}>Longest {plural(streak.longest, 'day')}</dd>}
          </div>
        )}
        {tokens.total > 0 && (
          <div className={s.figure}>
            <dt className={s.figLabel}>Tokens</dt>
            <dd className={s.figValue}>
              <span className={`${s.num} mono`}>{tokens.total}</span>
            </dd>
          </div>
        )}
      </dl>
      <details className={s.more}>
        <summary>
          More stats
          <span className={s.chev} aria-hidden="true">
            <Icon name="chev-down" size={16} />
          </span>
        </summary>
        <div className={s.moreBody}>
          <dl className={s.moreList}>
            <div className={s.moreRow}>
              <dt>Acceptance</dt>
              <dd>
                {acceptance.rate === null ? (
                  'No submissions yet'
                ) : (
                  <>
                    <span className="mono">{acceptance.rate}</span>
                    <span>%</span> · {acceptance.accepted} of {acceptance.judged} submissions accepted
                  </>
                )}
              </dd>
            </div>
            <div className={s.moreRow}>
              <dt>Fastest run</dt>
              <dd>
                {fast && fastest ? (
                  <>
                    <span className="mono">{fast.value}</span> <span>{fast.unit}</span> ·{' '}
                    <Link href={`/problems/${fastest.question.slug}`} className="focus-ring">
                      {fastest.question.title}
                    </Link>{' '}
                    · {LANG_LABEL[fastest.language] ?? fastest.language}
                  </>
                ) : (
                  'Not measured yet'
                )}
              </dd>
            </div>
          </dl>
          <p className={s.caption}>A streak counts UTC days with an accepted solve.</p>
        </div>
      </details>
    </section>
  );
}

/** The result card's looks, as a glyph and a tone, for the verdicts a row can carry. */
const VERDICT_LOOK: Record<Verdict, { icon: IconName; tone: 'ok' | 'err' | 'warn' | 'info' | 'muted' }> = {
  OK: { icon: 'check-circle', tone: 'ok' },
  WA: { icon: 'x', tone: 'err' },
  RE: { icon: 'alert', tone: 'err' },
  TLE: { icon: 'clock', tone: 'warn' },
  MLE: { icon: 'memory', tone: 'warn' },
  CE: { icon: 'code', tone: 'info' },
  XX: { icon: 'alert-circle', tone: 'muted' },
};

/** "Accepted" · "Wrong answer" · "Time limit exceeded" (the result card's words) plus the judge's short code; queued and running say so. */
function describeStatus(status: SubmissionStatus, kind: SubmissionKind) {
  if (status === 'queued' || status === 'running') {
    return { word: status === 'queued' ? 'Queued' : 'Running', code: null, icon: 'clock' as IconName, tone: 'accent' as const };
  }
  return { word: verdictTitle(status, kind === 'run' ? 'run' : 'submit'), code: status, ...VERDICT_LOOK[status] };
}

export function RecentSubmissions({ view, now }: { view: ProfileView; now: Date }) {
  if (view.recent.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon="history"
        headingLevel={3}
        title="No submissions yet"
        description={view.isOwner ? 'Open a problem and your attempts show up here with their runtime.' : undefined}
        action={
          view.isOwner ? (
            <ButtonLink href="/map" variant="primary" size="sm" className={s.cta}>
              Open the tier map
            </ButtonLink>
          ) : undefined
        }
      />
    );
  }
  return (
    <ul className={s.subs}>
      {view.recent.map((r) => {
        const verdict = describeStatus(r.status, r.kind);
        const t = r.runtimeUs === null ? null : formatMicros(r.runtimeUs);
        const ago = timeAgo(r.createdAt, now.getTime());
        return (
          <li key={r.id} className={s.sub} data-status={r.status}>
            <span className={s.glyph} data-tone={verdict.tone} aria-hidden="true">
              <Icon name={verdict.icon} size={16} />
            </span>
            <span className={s.subTitle}>
              {r.target ? (
                <Link href={`/problems/${r.target.slug}`} className="focus-ring">
                  {r.target.title}
                </Link>
              ) : (
                'A draft question'
              )}
            </span>
            <span className={s.when}>
              {view.isOwner ? (
                <Link href={`/submissions/${r.id}`} className="focus-ring">
                  {ago}
                </Link>
              ) : (
                ago
              )}
            </span>
            <span className={s.subMeta}>
              {r.target && <DifficultyText level={r.target.difficulty} />}
              <span className={s.verdict} data-tone={verdict.tone}>
                {verdict.word}
                {verdict.code && (
                  <span className={`${s.code} mono`} aria-hidden="true">
                    {verdict.code}
                  </span>
                )}
              </span>
              <span>
                <LangMark lang={r.language} />
                {LANG_LABEL[r.language] ?? r.language}
              </span>
              {r.kind !== 'submit' && <span>{r.kind}</span>}
              {t && (
                <span className="mono">
                  {t.value} {t.unit}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function BadgesPanel({ view }: { view: ProfileView }) {
  const handle = view.user.handle;
  const { earned, total } = view.badges;
  return (
    <Panel
      title="Badges"
      id="badges-title"
      note={earned.length > 0 ? `${earned.length} of ${total}` : undefined}
      action={<PanelLink href={`/u/${handle}/badges`}>View all</PanelLink>}
    >
      {earned.length === 0 ? (
        <p className={s.empty}>No badges yet — the gallery shows how to earn each one.</p>
      ) : (
        <div className={s.body}>
          <BadgeStrip handle={handle} badges={earned} />
        </div>
      )}
    </Panel>
  );
}

export function TokensPanel({ view }: { view: ProfileView }) {
  const max = Math.max(1, ...view.tokens.topics.map((t) => t.total));
  return (
    <Panel title="Tokens by topic" id="tokens-title" action={view.isOwner ? <PanelLink href="/map">Tier map</PanelLink> : undefined}>
      <div className={s.body}>
        <ul className={s.bars}>
          {view.tokens.topics.map((t) => (
            <li key={t.slug} className={s.barRow}>
              <span>{t.title}</span>
              <span className={`${s.barValue} mono`} title={`Easy ${t.byDifficulty.Easy} · Medium ${t.byDifficulty.Medium} · Hard ${t.byDifficulty.Hard}`}>
                <span aria-hidden="true">{t.total}</span>
                <span className="sr-only">
                  {plural(t.total, 'token')}: {t.byDifficulty.Easy} Easy, {t.byDifficulty.Medium} Medium, {t.byDifficulty.Hard} Hard
                </span>
              </span>
              <Progress value={t.total} max={max} tone="accent" />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function LearnPanel({ view }: { view: ProfileView }) {
  const started = view.learn.filter((t) => t.started);
  return (
    <Panel title="Learn progress" id="learn-title" action={<PanelLink href="/learn">Learn</PanelLink>}>
      <div className={s.body}>
        <ul className={s.bars}>
          {started.map((t) => (
            <li key={t.slug} className={s.barRow}>
              <span className={s.barName}>
                <Link href={`/learn/${t.slug}`} className="focus-ring">
                  {t.title}
                </Link>
                <span className={s.quiet}>{LEVEL_LABEL[t.level]}</span>
                {t.complete && (
                  <span className={s.complete}>
                    <Icon name="check" size={12} />
                    Complete
                  </span>
                )}
              </span>
              <span className={s.barValue}>
                <span className="mono">
                  {t.lessonsDone}/{t.lessonsTotal}
                </span>{' '}
                lessons ·{' '}
                <span className="mono">
                  {t.checkpointsPassed}/{t.checkpointsTotal}
                </span>{' '}
                checkpoints
              </span>
              <ProgressBar value={t.percent} tone={t.complete ? 'ok' : 'accent'} aria-label={`${t.title}: ${t.percent}% complete`} valueText={`${t.percent}%`} />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
