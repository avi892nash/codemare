import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageShell, SectionHead } from '@/components/Learn/parts';
import { Recommendation, TrackList } from '@/components/Learn/TrackCard';
import { requireViewer } from '@/components/Learn/viewer';
import { getLearnHome } from '@/lib/server/learnViews';

export const metadata: Metadata = { title: 'Learn · Codemare' };

/**
 * L3 — learn home, in the map's dialect: a header, the one thing to do next (start the first track, or pick up where
 * you left off) as a calm card with a single button, then the tracks as rows. How far you are is one quiet line, and
 * only the parts that are not zero.
 */
export default async function LearnHomePage() {
  const viewer = await requireViewer('/learn');
  const home = await getLearnHome(viewer.id);
  const { totals } = home;
  const firstVisit = totals.lessonsDone === 0 && totals.checkpointsPassed === 0;
  const progress = [
    `${totals.lessonsDone} of ${totals.lessonsTotal} lessons complete`,
    totals.checkpointsPassed > 0 && `${totals.checkpointsPassed} checkpoint${totals.checkpointsPassed === 1 ? '' : 's'} passed`,
    totals.tracksComplete > 0 && `${totals.tracksComplete} of ${home.tracks.length} tracks complete`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageShell>
      <PageHeader title="Learn" subtitle="Lessons with runnable code, then practice problems that put each idea to work." />

      {home.recommend && <Recommendation rec={home.recommend} firstVisit={firstVisit} />}

      <section aria-labelledby="tracks-title">
        <SectionHead title="Tracks" id="tracks-title" note={home.tracks.length > 0 ? progress : undefined} />
        {home.tracks.length === 0 ? (
          <EmptyState icon="graduation" title="No tracks yet" description="Lessons will appear here once content is published." />
        ) : (
          <TrackList items={home.tracks} />
        )}
      </section>
    </PageShell>
  );
}
