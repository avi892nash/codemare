import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/components/Learn/viewer';
import { LoopPage } from '@/components/Loop/LoopPage';
import { ActivityHeatmap } from '@/components/Profile/ActivityHeatmap';
import {
  BadgesPanel,
  LearnPanel,
  Panel,
  PanelLink,
  ProfileHeader,
  RecentSubmissions,
  StatsCard,
  TokensPanel,
} from '@/components/Profile/ProfileSections';
import s from '@/components/Profile/profile.module.css';
import { findProfileUser, getProfile, profileSections } from '@/lib/server/profile';

type Params = { handle: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findProfileUser(decodeURIComponent(handle));
  return { title: user ? `${user.name} (@${user.handle}) · Codemare` : 'Profile · Codemare' };
}

/**
 * 06 — public profile, in the Map's look. Any signed-in user can view any
 * profile; nothing private is shown (no email, no code). Unknown handle → 404.
 *
 * The page header, then only what there is to say: the numbers a learner
 * preparing looks at (once something is solved), the activity map (once there
 * is a week of it), recent submissions, and — beside them — badges, tokens by
 * topic and learn progress, each only when it has content.
 */
export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const viewer = await requireViewer(`/u/${handle}`);
  const now = new Date();
  const view = await getProfile(decodeURIComponent(handle), viewer.id, now);
  if (!view) notFound();

  const show = profileSections(view);

  return (
    <LoopPage label={`${view.user.name}’s profile`}>
      <ProfileHeader view={view} />
      {show.stats && <StatsCard view={view} />}
      {show.activity && (
        <Panel title="Activity" id="activity-title">
          <ActivityHeatmap
            weeks={view.activity.weeks.map((w) => w.map((d) => (d ? { day: d.day, count: d.count, level: d.level } : null)))}
            total={view.activity.total}
            activeDays={view.activity.activeDays}
          />
        </Panel>
      )}
      <div className={s.columns}>
        <Panel
          title="Recent submissions"
          id="recent-title"
          action={view.isOwner && view.recent.length > 0 ? <PanelLink href="/submissions">All submissions</PanelLink> : undefined}
        >
          <RecentSubmissions view={view} now={now} />
        </Panel>
        <div className={s.stack}>
          <BadgesPanel view={view} />
          {show.tokens && <TokensPanel view={view} />}
          {show.learn && <LearnPanel view={view} />}
        </div>
      </div>
    </LoopPage>
  );
}
