import type { Metadata } from 'next';
import Link from 'next/link';
import { HashScroll } from '@/components/Loop/HashScroll';
import { LoopHero, LoopPage, SectionHead } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { ComponentCard } from '@/components/MyLibrary/ComponentCard';
import s from '@/components/MyLibrary/library.module.css';
import { EmptyState } from '@/components/states/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { languageLabel } from '@/lib/client/languages';
import { getMyLibraryView } from '@/lib/server/loopViews';

export const metadata: Metadata = { title: 'My Library · Codemare' };
export const dynamic = 'force-dynamic';

/**
 * T3 — My Library: every component the learner has built, with its latest
 * passing code per language, version history, what it calls and what
 * calls it, and a way back to the queue to rebuild it.
 */
export default async function MyLibraryPage() {
  const viewer = await requireViewer('/me/library');
  const lib = await getMyLibraryView(viewer.id);
  const now = Date.now();
  const { totals } = lib;

  return (
    <LoopPage label="My Library">
      <LoopHero
        icon="puzzle"
        eyebrow="My Library"
        title="Your components"
        subtitle="Functions you’ve built and passed. Later builds run with your latest passing version of what they call prepended — this is the code they call."
        stats={[
          { label: 'Built', value: totals.built, unit: `/ ${totals.total}`, testId: 'library-built' },
          { label: 'Versions', value: totals.versions },
          {
            label: 'Languages',
            value:
              totals.languages.length === 0 ? (
                '—'
              ) : (
                <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>
                  {totals.languages.map((l) => (
                    <span key={l} title={languageLabel(l)} style={{ display: 'inline-flex' }}>
                      <LangMark lang={l} size={15} />
                      <span className="sr-only">{languageLabel(l)}</span>
                    </span>
                  ))}
                </span>
              ),
          },
        ]}
      />

      {lib.built.length === 0 ? (
        <EmptyState
          icon="puzzle"
          title="Nothing built yet"
          description="Pass a build step in your queue and the component lands here — with its code, its versions, and the components that will call it."
          action={
            <ButtonLink href="/queue" variant="primary" icon="layers">
              Open your queue
            </ButtonLink>
          }
          style={{ border: '1px dashed var(--line-3)', borderRadius: 'var(--r-lg)', background: 'var(--bg-1)' }}
        />
      ) : (
        <section aria-labelledby="built-title">
          <SectionHead title="Built" id="built-title" note={`${totals.built} component${totals.built === 1 ? '' : 's'}`} />
          <ul className={s.list}>
            {lib.built.map((c) => (
              <li key={c.id}>
                <ComponentCard c={c} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {lib.unbuilt.length > 0 && (
        <section aria-labelledby="unbuilt-title">
          <SectionHead title="Not built yet" id="unbuilt-title" note="In dependency order within each topic" />
          <ul className={s.pending}>
            {lib.unbuilt.map((c) => (
              <li key={c.id} className={s.pendingItem} data-testid={`unbuilt-${c.slug}`}>
                <Icon name={c.topic.unlocked ? 'circle' : 'lock'} size={14} />
                <span className={s.pendingText}>
                  <span className={s.pendingTitle}>{c.title}</span>
                  <span className={s.pendingMeta}>
                    {c.topic.title}
                    {c.dependsOn.length > 0 && <> · calls {c.dependsOn.map((d) => d.title).join(', ')}</>}
                  </span>
                </span>
                {c.topic.unlocked ? (
                  c.nextStepId && (
                    <ButtonLink href={`/queue?step=${encodeURIComponent(c.nextStepId)}`} size="xs" iconRight="arrow-right" aria-label={`Build ${c.title}`}>
                      Build
                    </ButtonLink>
                  )
                ) : (
                  <Link href={`/map#topic-${c.topic.slug}`} className="focus-ring" style={{ fontSize: 12, color: 'var(--fg-2)', borderRadius: 3 }}>
                    Unlock
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <HashScroll />
    </LoopPage>
  );
}
