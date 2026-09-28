import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/Learn/parts';
import { requireViewer } from '@/components/Learn/viewer';
import { ActivityHeatmap } from '@/components/Profile/ActivityHeatmap';
import {
  BadgesPanel,
  ComponentsPanel,
  LearnPanel,
  Panel,
  ProfileHeader,
  RecentSubmissions,
  StatTiles,
  TokensPanel,
} from '@/components/Profile/ProfileSections';
import s from '@/components/Profile/profile.module.css';
import { findProfileUser, getProfile } from '@/lib/server/profile';

type Params = { handle: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findProfileUser(decodeURIComponent(handle));
  return { title: user ? `${user.name} (@${user.handle}) · Codemare` : 'Profile · Codemare' };
}

/**
 * 06 — public profile. Any signed-in user can view any profile; nothing
 * private is shown (no email, no code). Unknown handle → 404.
 */
export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const viewer = await requireViewer(`/u/${handle}`);
  const now = new Date();
  const view = await getProfile(decodeURIComponent(handle), viewer.id, now);
  if (!view) notFound();

  return (
    <PageShell label={`${view.user.name}’s profile`}>
      <ProfileHeader view={view} />
      <StatTiles view={view} />
      <Panel title="Activity" id="activity-title">
        <ActivityHeatmap
          weeks={view.activity.weeks.map((w) => w.map((d) => (d ? { day: d.day, count: d.count, level: d.level } : null)))}
          total={view.activity.total}
          activeDays={view.activity.activeDays}
        />
      </Panel>
      <div className={s.columns}>
        <div className={s.stack}>
          <Panel title="Recent submissions" id="recent-title">
            <RecentSubmissions view={view} now={now} />
          </Panel>
          <LearnPanel view={view} />
        </div>
        <div className={s.stack}>
          <BadgesPanel view={view} />
          <TokensPanel view={view} />
          <ComponentsPanel view={view} />
        </div>
      </div>
    </PageShell>
  );
}
