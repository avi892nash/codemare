import type { Metadata } from 'next';
import { EmptyState } from '@/components/states/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { PageShell, SectionHead } from '@/components/Learn/parts';
import { ContinueCard, TrackCard } from '@/components/Learn/TrackCard';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { getLearnHome } from '@/lib/server/learnViews';

export const metadata: Metadata = { title: 'Learn · Codemare' };

/** L3 — learn home: tracks with progress and "continue where you left off". */
export default async function LearnHomePage() {
  const viewer = await requireViewer('/learn');
  const home = await getLearnHome(viewer.id);
  const { totals } = home;

  return (
    <PageShell>
      <header className={s.hero}>
        <div className={s.header}>
          <span className={s.eyebrow}>
            <Icon name="graduation" size={13} /> Learn
          </span>
          <h1 className={s.title}>Learn the patterns behind the problems</h1>
          <p className={s.subtitle}>
            Short lessons with runnable code and step-through visualizations, a checkpoint after every module, and practice
            problems that put each idea to work.
          </p>
        </div>
        <dl className={s.stats} style={{ margin: 0 }}>
          <div className={s.stat}>
            <dt className={s.statLabel}>Lessons done</dt>
            <dd className="mono" style={{ margin: 0 }}>
              <span className={s.statValue}>{totals.lessonsDone}</span>
              <span className={s.statUnit}>/ {totals.lessonsTotal}</span>
            </dd>
          </div>
          <div className={s.stat}>
            <dt className={s.statLabel}>Checkpoints passed</dt>
            <dd className="mono" style={{ margin: 0 }}>
              <span className={s.statValue}>{totals.checkpointsPassed}</span>
            </dd>
          </div>
          <div className={s.stat}>
            <dt className={s.statLabel}>Tracks complete</dt>
            <dd className="mono" style={{ margin: 0 }}>
              <span className={s.statValue}>{totals.tracksComplete}</span>
              <span className={s.statUnit}>/ {home.tracks.length}</span>
            </dd>
          </div>
        </dl>
      </header>

      {home.continue && <ContinueCard track={home.continue.track} step={home.continue.step} />}

      <section aria-labelledby="tracks-title">
        <SectionHead title="Tracks" id="tracks-title" note={home.continue ? undefined : 'Start with Foundations if you are new'} />
        {home.tracks.length === 0 ? (
          <EmptyState icon="graduation" title="No tracks yet" description="Lessons will appear here once content is published." />
        ) : (
          <div className={s.trackGrid}>
            {home.tracks.map((item, i) => (
              <TrackCard key={item.track.slug} item={item} index={i} />
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
