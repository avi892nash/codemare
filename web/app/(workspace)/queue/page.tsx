import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LoopHero, LoopPage, SectionHead } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { Markdown } from '@/components/Problem/Markdown';
import { BuildStep } from '@/components/Queue/BuildStep';
import { PredictStep } from '@/components/Queue/PredictStep';
import { QueueList, firstPendingStep, stepHref } from '@/components/Queue/QueueList';
import { SuggestionCards } from '@/components/Queue/Suggestions';
import s from '@/components/Queue/queue.module.css';
import { EmptyState } from '@/components/states/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Pill } from '@/components/ui/Pill';
import { LANGUAGE_META } from '@/lib/client/languages';
import { canAccessBuildStep, type TopicRef } from '@/lib/server/access';
import { NotFoundError } from '@/lib/server/errors';
import { getPredictStepView } from '@/lib/server/loopViews';
import { getQueue, type QueueComponentView, type QueueView } from '@/lib/server/queue';
import { loadBuildStep } from '@/lib/server/runner';

export const metadata: Metadata = { title: 'Queue · Codemare' };
export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

function WaitingCard({ owner, queue, stepTitle }: { owner: QueueComponentView; queue: QueueView; stepTitle: string }) {
  return (
    <section className={`${s.card} ${s.notice}`} aria-labelledby="waiting-title" data-testid="waiting-step">
      <div>
        <div className={s.stepMeta}>
          <Pill tone="muted" size="xs" icon="clock">
            Waiting
          </Pill>
          <span>
            <strong>{owner.title}</strong> · {owner.topic.title}
          </span>
        </div>
        <h2 className={s.stepTitle} id="waiting-title">
          {stepTitle}
        </h2>
      </div>
      <p className={s.noticeText}>
        {owner.title} calls code you haven’t built yet. Builds run with your latest passing version of each dependency prepended, so
        those come first.
      </p>
      <ul className={s.noticeList}>
        {owner.waitingOn.map((w) => {
          const step = w.reason === 'not_built' ? firstPendingStep(queue, w.slug) : null;
          return (
            <li key={w.slug}>
              {w.reason === 'topic_locked' ? (
                <ButtonLink href="/map" icon="map" size="sm">
                  Unlock {w.topicTitle ?? 'its topic'} for {w.title}
                </ButtonLink>
              ) : step ? (
                <ButtonLink href={stepHref(step)} variant="primary" iconRight="arrow-right" size="sm">
                  Build {w.title} first
                </ButtonLink>
              ) : (
                <span className={s.noticeText}>Build {w.title} first.</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LockedCard({ topics }: { topics: TopicRef[] }) {
  const topic = topics[0];
  return (
    <section className={`${s.card} ${s.notice}`} aria-labelledby="locked-title" data-testid="locked-step">
      <div className={s.stepMeta}>
        <Pill tone="muted" size="xs" icon="lock">
          Locked
        </Pill>
      </div>
      <h2 className={s.stepTitle} id="locked-title">
        This step is locked
      </h2>
      <p className={s.noticeText}>
        Its topic, <strong>{topic?.title ?? 'this topic'}</strong>, isn’t unlocked yet. Spend a recipe on the map to open it — its components
        join your queue.
      </p>
      <div>
        <ButtonLink href={topic ? `/map#topic-${topic.slug}` : '/map'} variant="primary" icon="map">
          Open the map
        </ButtonLink>
      </div>
    </section>
  );
}

function CaughtUp({ queue }: { queue: QueueView }) {
  const waiting = queue.components.some((c) => c.state === 'waiting');
  return (
    <>
      <section className={s.card} data-testid="queue-caught-up">
        <EmptyState
          icon="check-circle"
          size="sm"
          headingLevel={2}
          title={queue.components.length === 0 ? 'Nothing to build yet' : 'All caught up'}
          description={
            queue.components.length === 0
              ? 'Components arrive with the topics you unlock. Earn tokens, then spend them on the map.'
              : waiting
                ? 'Every ready step is done — the rest wait on components you haven’t built.'
                : 'Every step of your unlocked components is done. Unlock a topic on the map for more.'
          }
          action={
            <>
              <ButtonLink href="/map" variant="primary" icon="map">
                Tier map
              </ButtonLink>
              <ButtonLink href="/me/library" icon="puzzle">
                My Library
              </ButtonLink>
            </>
          }
        />
      </section>
      {queue.suggestions.length > 0 && (
        <section aria-labelledby="suggested-title">
          <SectionHead title="Next up: earn what the map needs" id="suggested-title" />
          <SuggestionCards items={queue.suggestions} />
        </section>
      )}
    </>
  );
}

/**
 * T2a/T2b — the queue. The current step (or `?step=`) fills the page: a
 * predict step as a card next to the queue list, a build step as the
 * full-height solving workspace under a queue bar. Steps come in
 * dependency order; suggested problems follow once they're done.
 */
export default async function QueuePage({ searchParams }: { searchParams: Search }) {
  const search = await searchParams;
  const stepParam = typeof search.step === 'string' && search.step.length <= 100 ? search.step : null;
  const viewer = await requireViewer(stepParam ? `/queue?step=${encodeURIComponent(stepParam)}` : '/queue');
  const queue = await getQueue(viewer.id);

  const focusId = stepParam ?? queue.current?.stepId ?? null;
  const owner = focusId ? queue.components.find((c) => c.steps.some((st) => st.stepId === focusId)) ?? null : null;
  const step = owner?.steps.find((st) => st.stepId === focusId) ?? null;
  const nextEntry = queue.upNext.find((e) => e.stepId !== focusId) ?? null;
  const next = nextEntry ? { href: stepHref(nextEntry.stepId), title: nextEntry.title, kind: nextEntry.kind } : null;

  // A build step (ready, or done and being rebuilt): the full-height workspace.
  if (owner && step && step.kind === 'build' && (owner.state !== 'waiting' || step.done)) {
    const data = await loadBuildStep(viewer.id, step.stepId);
    return (
      <BuildStep
        key={step.stepId}
        problem={data.problem}
        statement={<Markdown>{data.promptMd}</Markdown>}
        build={data.build}
        hints={{ target: { buildStepId: step.stepId }, initial: data.hints }}
        latestCode={data.latestCode}
        passed={data.passed}
        component={{ slug: owner.slug, title: owner.title, topicTitle: owner.topic.title }}
        step={{ index: step.index, count: step.count }}
        dependencies={owner.dependencies}
        next={next}
        queue={queue}
      />
    );
  }

  let main: ReactNode;
  if (focusId && !owner) {
    const access = await canAccessBuildStep(viewer.id, focusId).catch((e) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    });
    if (!access || access.ok) notFound();
    main = <LockedCard topics={access.lockedTopics} />;
  } else if (owner && step && step.kind === 'predict') {
    const view = await getPredictStepView(viewer.id, step.stepId);
    main = (
      <PredictStep
        key={step.stepId}
        view={view}
        prompt={<Markdown>{view.promptMd}</Markdown>}
        snippet={<CodeBlock code={view.code} language={view.language} filename={`snippet.${LANGUAGE_META[view.language].ext}`} />}
        meta={{ componentTitle: owner.title, topicTitle: owner.topic.title, index: step.index, count: step.count }}
        next={next}
      />
    );
  } else if (owner && step) {
    main = <WaitingCard owner={owner} queue={queue} stepTitle={step.title} />;
  } else {
    main = <CaughtUp queue={queue} />;
  }

  const { totals } = queue;
  return (
    <LoopPage label="Queue">
      <LoopHero
        icon="layers"
        eyebrow="Queue"
        title="Predict it, then build it"
        subtitle="Each component starts with a snippet to read, then you write it. What you pass lands in My Library — and later components call it."
        stats={[
          { label: 'Steps done', value: totals.stepsDone, unit: `/ ${totals.stepsTotal}`, testId: 'queue-steps-done' },
          { label: 'Components built', value: totals.componentsDone, unit: `/ ${totals.componentsTotal}` },
        ]}
      />
      <div className={s.layout}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>{main}</div>
        <aside className={s.aside} aria-label="Queue list">
          <QueueList queue={queue} focusId={focusId} />
        </aside>
      </div>
    </LoopPage>
  );
}
