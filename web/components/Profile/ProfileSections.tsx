import Link from 'next/link';
import type { ReactNode } from 'react';
import { BadgeStrip } from '@/components/Badges/BadgeStrip';
import { LevelPill } from '@/components/Learn/parts';
import { Avatar } from '@/components/ui/Avatar';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon, type IconName } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { Pill } from '@/components/ui/Pill';
import { Progress } from '@/components/ui/Progress';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusPill, isStatusCode } from '@/components/ui/StatusPill';
import { formatMicros, timeAgo } from '@/lib/client/format';
import type { ProfileView } from '@/lib/server/profile';
import type { Difficulty } from '@/lib/types';
import s from './profile.module.css';

const LANG_LABEL: Record<string, string> = { python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', java: 'Java', go: 'Go' };

const fmtMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });


export function ProfileHeader({ view }: { view: ProfileView }) {
  const { user } = view;
  return (
    <header className={s.identity}>
      <Avatar name={user.name} src={user.image} size={64} />
      <div style={{ minWidth: 0 }}>
        <h1 className={s.name}>{user.name}</h1>
        <p className={s.handleLine}>
          <span className="mono">@{user.handle}</span>
          <span>Joined {fmtMonth(user.joinedAt)}</span>
          {user.role !== 'learner' && (
            <Pill tone="accent" size="xs" style={{ textTransform: 'capitalize' }}>
              {user.role}
            </Pill>
          )}
          {view.isOwner && (
            <Pill tone="muted" size="xs">
              This is you
            </Pill>
          )}
        </p>
      </div>
      <dl className={s.quick} style={{ margin: 0 }}>
        <div className={s.quickItem}>
          <dt className={s.quickLabel}>Solved</dt>
          <dd className={`${s.quickValue} mono`}>{view.solved.total}</dd>
        </div>
        <div className={s.quickItem}>
          <dt className={s.quickLabel}>Badges</dt>
          <dd className={`${s.quickValue} mono`}>{view.badges.earned.length}</dd>
        </div>
        <div className={s.quickItem}>
          <dt className={s.quickLabel}>Tokens</dt>
          <dd className={`${s.quickValue} mono`}>{view.tokens.total}</dd>
        </div>
      </dl>
    </header>
  );
}

function Tile({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className={s.tile}>
      <dt className={s.tileLabel}>
        <Icon name={icon} size={12} />
        {label}
      </dt>
      {children}
    </div>
  );
}

const DIFFS: Difficulty[] = ['Easy', 'Medium', 'Hard'];
const DIFF_TONE = { Easy: 'ok', Medium: 'warn', Hard: 'err' } as const;

export function StatTiles({ view }: { view: ProfileView }) {
  const { solved, acceptance, fastest, streak } = view;
  const catalogTotal = solved.catalog.Easy + solved.catalog.Medium + solved.catalog.Hard;
  // Same runtime formatting as the editor and the submissions list.
  const fast = fastest ? formatMicros(fastest.runtimeUs) : null;
  return (
    <dl className={s.tiles}>
      <Tile icon="check-circle" label="Solved">
        <dd className={s.tileValue} style={{ margin: 0 }}>
          <span className={`${s.big} mono`}>{solved.total}</span>
          <span className={`${s.unit} mono`}>/ {catalogTotal}</span>
        </dd>
        <dd className={s.diffRows} style={{ margin: 0 }}>
          {DIFFS.map((d) => (
            <span key={d} className={s.diffRow}>
              <DifficultyPill level={d} size="xs" />
              <Progress value={solved.byDifficulty[d]} max={Math.max(1, solved.catalog[d])} tone={DIFF_TONE[d]} />
              <span className="mono">
                {solved.byDifficulty[d]}/{solved.catalog[d]}
              </span>
            </span>
          ))}
        </dd>
      </Tile>
      <Tile icon="target" label="Acceptance">
        <dd className={s.tileValue} style={{ margin: 0 }}>
          <span className={`${s.big} mono`}>{acceptance.rate === null ? '—' : acceptance.rate}</span>
          {acceptance.rate !== null && <span className={`${s.unit} mono`}>%</span>}
        </dd>
        <dd className={s.sub} style={{ margin: 0 }}>
          {acceptance.judged ? `${acceptance.accepted} of ${acceptance.judged} submissions accepted` : 'No submissions yet'}
        </dd>
      </Tile>
      <Tile icon="zap" label="Fastest run">
        <dd className={s.tileValue} style={{ margin: 0 }}>
          <span className={`${s.big} mono`}>{fast ? fast.value : '—'}</span>
          {fast && <span className={`${s.unit} mono`}>{fast.unit}</span>}
        </dd>
        <dd className={s.sub} style={{ margin: 0 }}>
          {fastest ? (
            <>
              <Link href={`/problems/${fastest.question.slug}`} className="focus-ring">
                {fastest.question.title}
              </Link>{' '}
              · {LANG_LABEL[fastest.language] ?? fastest.language}
            </>
          ) : (
            'CPU time of an accepted submission'
          )}
        </dd>
      </Tile>
      <Tile icon="flame" label="Streak">
        <dd className={s.tileValue} style={{ margin: 0 }}>
          <span className={`${s.big} mono`}>{streak.current}</span>
          <span className={s.unit}>day{streak.current === 1 ? '' : 's'}</span>
        </dd>
        <dd className={s.sub} style={{ margin: 0 }}>
          Longest {streak.longest} day{streak.longest === 1 ? '' : 's'} · UTC days with an accepted solve
        </dd>
      </Tile>
    </dl>
  );
}

export function Panel({ title, id, action, children }: { title: string; id: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.panel} aria-labelledby={id}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle} id={id}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RecentSubmissions({ view, now }: { view: ProfileView; now: Date }) {
  if (view.recent.length === 0) {
    return <p className={s.empty}>No submissions yet.</p>;
  }
  return (
    <ul className={s.subs}>
      {view.recent.map((r) => {
        const title =
          r.target?.kind === 'question' ? (
            <Link href={`/problems/${r.target.slug}`} className="focus-ring">
              {r.target.title}
            </Link>
          ) : (
            <span className={s.subName}>{r.target?.title ?? 'A draft question'}</span>
          );
        const status = isStatusCode(r.status) ? r.status : 'PND';
        const t = r.runtimeUs === null ? null : formatMicros(r.runtimeUs);
        return (
          <li key={r.id} className={s.subRow}>
            <StatusPill code={status} size="xs" withIcon={status === 'PND'} />
            <span className={s.subTitle}>
              {title}
              <span className={s.subMeta}>
                <LangMark lang={r.language} size={11} />
                {LANG_LABEL[r.language] ?? r.language} · {r.kind}
                {r.target?.kind === 'question' && <DifficultyPill level={r.target.difficulty} size="xs" />}
              </span>
            </span>
            <span className={s.subSide}>
              {t && (
                <span className="mono">
                  {t.value} {t.unit}
                </span>
              )}
              <br />
              {view.isOwner ? (
                <Link href={`/submissions/${r.id}`} className="focus-ring" style={{ color: 'var(--fg-2)', borderRadius: 3 }}>
                  {timeAgo(r.createdAt, now.getTime())}
                </Link>
              ) : (
                timeAgo(r.createdAt, now.getTime())
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
  return (
    <Panel
      title="Badges"
      id="badges-title"
      action={
        <Link href={`/u/${handle}/badges`} className={`${s.panelLink} focus-ring`}>
          All {view.badges.total} <Icon name="arrow-right" size={12} />
        </Link>
      }
    >
      {view.badges.earned.length === 0 ? (
        <p className={s.empty}>No badges yet — the gallery shows how to earn each one.</p>
      ) : (
        <div className={s.panelBody}>
          <BadgeStrip handle={handle} badges={view.badges.earned} />
        </div>
      )}
    </Panel>
  );
}

export function TokensPanel({ view }: { view: ProfileView }) {
  const max = Math.max(1, ...view.tokens.topics.map((t) => t.total));
  return (
    <Panel
      title="Tokens by topic"
      id="tokens-title"
      action={
        view.isOwner ? (
          <Link href="/map" className={`${s.panelLink} focus-ring`}>
            Tier map <Icon name="arrow-right" size={12} />
          </Link>
        ) : undefined
      }
    >
      {view.tokens.topics.length === 0 ? (
        <p className={s.empty}>No tokens yet — accepted solves and builds earn them.</p>
      ) : (
        <div className={s.panelBody}>
          <ul className={s.bars}>
            {view.tokens.topics.map((t) => (
              <li key={t.slug} className={s.barRow}>
                <span>{t.title}</span>
                <span className={`${s.barValue} mono`} title={`Easy ${t.byDifficulty.Easy} · Medium ${t.byDifficulty.Medium} · Hard ${t.byDifficulty.Hard}`}>
                  {t.total}
                  <span className="sr-only">
                    {' '}
                    tokens: {t.byDifficulty.Easy} Easy, {t.byDifficulty.Medium} Medium, {t.byDifficulty.Hard} Hard
                  </span>
                </span>
                <Progress value={t.total} max={max} tone="accent" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function LearnPanel({ view }: { view: ProfileView }) {
  const started = view.learn.filter((t) => t.started);
  return (
    <Panel
      title="Learn progress"
      id="learn-title"
      action={
        <Link href="/learn" className={`${s.panelLink} focus-ring`}>
          Learn <Icon name="arrow-right" size={12} />
        </Link>
      }
    >
      {started.length === 0 ? (
        <p className={s.empty}>No lessons started yet.</p>
      ) : (
        <div className={s.panelBody}>
          <ul className={s.bars}>
            {started.map((t) => (
              <li key={t.slug} className={s.barRow}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Link href={`/learn/${t.slug}`} className="focus-ring">
                    {t.title}
                  </Link>
                  <LevelPill level={t.level} />
                  {t.complete && (
                    <Pill tone="ok" size="xs" icon="check">
                      Complete
                    </Pill>
                  )}
                </span>
                <span className={`${s.barValue} mono`}>
                  {t.lessonsDone}/{t.lessonsTotal} lessons · {t.checkpointsPassed}/{t.checkpointsTotal} checkpoints
                </span>
                <ProgressBar value={t.percent} tone={t.complete ? 'ok' : 'accent'} aria-label={`${t.title}: ${t.percent}% complete`} valueText={`${t.percent}%`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export function ComponentsPanel({ view }: { view: ProfileView }) {
  return (
    <Panel
      title="Components built"
      id="components-title"
      action={
        view.isOwner ? (
          <Link href="/me/library" className={`${s.panelLink} focus-ring`}>
            My Library <Icon name="arrow-right" size={12} />
          </Link>
        ) : undefined
      }
    >
      {view.components.length === 0 ? (
        <p className={s.empty}>No components built yet.</p>
      ) : (
        <div className={s.panelBody}>
          <ul className={s.chips}>
            {view.components.map((c) => (
              <li key={c.slug} className={s.chip}>
                <Icon name="puzzle" size={13} style={{ color: 'var(--accent-hi)' }} />
                {c.title}
                {c.languages.map((l) => (
                  <LangMark key={l} lang={l} size={12} />
                ))}
                <span className="sr-only">in {c.languages.map((l) => LANG_LABEL[l] ?? l).join(', ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
