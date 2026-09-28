import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { QueueComponentView, QueueSuggestion, QueueView } from '@/lib/server/queue';
import s from './queue.module.css';

/** Link to a step of the queue. */
export function stepHref(stepId: string): string {
  return `/queue?step=${encodeURIComponent(stepId)}`;
}

export const KIND_LABEL = { predict: 'Predict', build: 'Build' } as const;

/** The first unfinished step of a component in the queue (to link a dependency to). */
export function firstPendingStep(queue: QueueView, slug: string): string | null {
  const c = queue.components.find((x) => x.slug === slug);
  return c?.steps.find((st) => !st.done)?.stepId ?? null;
}

function WaitReason({ queue, c }: { queue: QueueView; c: QueueComponentView }) {
  return (
    <span className={s.waitWhy}>
      Waits for{' '}
      {c.waitingOn.map((w, i) => {
        const step = w.reason === 'not_built' ? firstPendingStep(queue, w.slug) : null;
        return (
          <span key={w.slug}>
            {i > 0 && (i === c.waitingOn.length - 1 ? ' and ' : ', ')}
            {w.reason === 'topic_locked' ? (
              <>
                {w.title} — unlock{' '}
                <Link href="/map" className="focus-ring">
                  {w.topicTitle ?? 'its topic'}
                </Link>{' '}
                first
              </>
            ) : step ? (
              <>
                your{' '}
                <Link href={stepHref(step)} className="focus-ring">
                  {w.title}
                </Link>{' '}
                build
              </>
            ) : (
              <>your {w.title} build</>
            )}
          </span>
        );
      })}
      .
    </span>
  );
}

function SuggestionLink({ item }: { item: QueueSuggestion }) {
  if (item.kind === 'gate') {
    return (
      <Link href={item.attemptId ? `/map/gates/${encodeURIComponent(item.attemptId)}` : `/map#gate-${item.gateId}`} className="focus-ring">
        <span className={s.plainItem}>
          <Icon name="shield" size={12} style={{ color: 'var(--accent-hi)' }} />
          {item.state === 'running' ? `Continue the ${item.title}` : `Take the ${item.title}`}
        </span>
      </Link>
    );
  }
  return (
    <Link href={`/problems/${encodeURIComponent(item.slug)}`} className="focus-ring">
      <span className={s.plainItem}>
        <Icon name="code" size={12} style={{ color: 'var(--fg-2)' }} />
        <span className={s.stepName}>{item.title}</span>
        <span className={s.award}>{item.award.map((a) => `+${a.amount}`).join(' ')}</span>
      </span>
    </Link>
  );
}

/**
 * The queue as a list: what's up next (component by component, each step
 * linkable), what waits on what, suggested problems, what's done, and what
 * unlocks later. Hook-free, so it renders in the page's aside (server) and
 * in the build view's modal (client).
 */
export function QueueList({ queue, focusId, idPrefix = 'q' }: { queue: QueueView; focusId: string | null; idPrefix?: string }) {
  const ready = queue.components.filter((c) => c.state === 'ready');
  const waiting = queue.components.filter((c) => c.state === 'waiting');
  const done = queue.components.filter((c) => c.state === 'done');
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <nav className={s.list} aria-label="Your queue" data-testid="queue-list">
      <section className={s.listSection} aria-labelledby={id('next')}>
        <h2 className={s.listHead} id={id('next')}>
          Up next <span className={s.listCount}>{queue.upNext.length}</span>
        </h2>
        {ready.length === 0 ? (
          <p className={s.waitWhy}>
            {queue.components.length === 0 ? 'Unlock a topic with components to start building.' : 'No step is ready right now.'}
          </p>
        ) : (
          <ol className={s.comps}>
            {ready.map((c) => (
              <li key={c.id} className={s.comp} data-current={c.steps.some((st) => st.stepId === focusId) || undefined}>
                <div className={s.compHead}>
                  <Icon name="puzzle" size={13} />
                  <span className={s.compTitle}>{c.title}</span>
                  <span className={s.compTopic}>{c.topic.title}</span>
                </div>
                <ol className={s.steps}>
                  {c.steps.map((st) => {
                    const current = st.stepId === focusId;
                    return (
                      <li key={st.stepId}>
                        <Link
                          href={stepHref(st.stepId)}
                          className={s.stepLink}
                          aria-current={current ? 'step' : undefined}
                          data-done={st.done || undefined}
                          data-testid={`queue-step-${st.stepId}`}
                        >
                          <span className={s.stepIcon} aria-hidden="true">
                            <Icon name={st.done ? 'check-circle' : current ? 'play' : 'circle'} size={13} />
                          </span>
                          <span className={s.stepName}>
                            {st.title}
                            <span className="sr-only">{st.done ? ' (done)' : current ? ' (open)' : ''}</span>
                          </span>
                          <span className={s.stepKind}>{KIND_LABEL[st.kind]}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </section>

      {waiting.length > 0 && (
        <section className={s.listSection} aria-labelledby={id('waiting')}>
          <h2 className={s.listHead} id={id('waiting')}>
            Waiting <span className={s.listCount}>{waiting.length}</span>
          </h2>
          <ul className={s.comps}>
            {waiting.map((c) => (
              <li key={c.id} className={s.waitRow} data-testid={`queue-waiting-${c.slug}`}>
                <span className={s.waitTitle}>
                  <Icon name="clock" size={12} />
                  {c.title}
                </span>
                <WaitReason queue={queue} c={c} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.suggestions.length > 0 && (
        <section className={s.listSection} aria-labelledby={id('suggested')}>
          <h2 className={s.listHead} id={id('suggested')}>
            Then
          </h2>
          <ul className={s.plainList}>
            {queue.suggestions.map((item) => (
              <li key={item.kind === 'gate' ? `gate-${item.gateId}` : item.slug}>
                <SuggestionLink item={item} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className={s.listSection} aria-labelledby={id('done')}>
          <details className={s.done}>
            <summary className="focus-ring" style={{ borderRadius: 4 }}>
              <h2 className={s.listHead} id={id('done')} style={{ display: 'inline-flex', gap: 6 }}>
                <Icon name="chev-right" size={11} /> Built <span className={s.listCount}>{done.length}</span>
              </h2>
            </summary>
            <ul className={s.plainList}>
              {done.map((c) => (
                <li key={c.id}>
                  <Link href={`/me/library#component-${c.slug}`} className="focus-ring">
                    <span className={s.plainItem}>
                      <Icon name="check-circle" size={12} style={{ color: 'var(--ok-fg)' }} />
                      {c.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {queue.locked.length > 0 && (
        <section className={s.listSection} aria-labelledby={id('locked')}>
          <h2 className={s.listHead} id={id('locked')}>
            Later
          </h2>
          <ul className={s.plainList}>
            {queue.locked.map((g) => (
              <li key={g.topic.slug}>
                <Link href={`/map#topic-${g.topic.slug}`} className="focus-ring">
                  <span className={s.plainItem}>
                    <Icon name="lock" size={12} style={{ color: 'var(--fg-2)' }} />
                    <span>
                      {g.topic.title}: {g.components.map((c) => c.title).join(', ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
