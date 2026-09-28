import { ButtonLink } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import type { LockedTopicBlocker } from '@/lib/server/runner';
import type { Difficulty } from '@/lib/types';
import s from './Problem.module.css';

function when(d: Date | string | null | undefined): string {
  if (!d) return 'soon';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

function BlockerBody({ b }: { b: LockedTopicBlocker }) {
  const k = b.blocker;
  if (!k) return <p className={s.blockerText}>Locked.</p>;
  if (k.kind === 'no_recipe') return <p className={s.blockerText}>This topic has no unlock recipe yet.</p>;
  if (k.kind === 'gate') {
    const g = k.gate;
    const state =
      !g
        ? 'Its gate isn’t set up yet.'
        : g.state === 'eligible'
          ? `Pass the ${g.gate.title} to open it — you can start it now.`
          : g.state === 'running'
            ? `Your ${g.gate.title} attempt is running.`
            : g.state === 'cooldown'
              ? `The ${g.gate.title} is cooling down — retry after ${when(g.nextEligibleAt)}.`
              : `Open the tier before it first, then pass the ${g.gate.title}.`;
    return (
      <p className={s.blockerText}>
        The <strong>{k.tier.title}</strong> tier is closed. {state}
      </p>
    );
  }
  const r = k.cheapest;
  return (
    <>
      <p className={s.blockerText}>
        {r.ready ? (
          <>
            Ready — spend <strong>{r.title}</strong> on the map to unlock it.
          </>
        ) : (
          <>
            Cheapest recipe, <strong>{r.title}</strong>: {r.missing} more token{r.missing === 1 ? '' : 's'}.
          </>
        )}
      </p>
      <div className={s.items}>
        {r.items.map((it) => (
          <Pill key={`${it.topic.id}-${it.minDifficulty}`} size="xs" tone={it.missing === 0 ? 'ok' : 'warn'} icon="coin">
            {it.topic.title} {Math.min(it.have, it.need)}/{it.need}
            {it.minDifficulty !== 'Easy' ? ` · ${it.minDifficulty}+` : ''}
          </Pill>
        ))}
      </div>
    </>
  );
}

/**
 * The page a locked question renders instead of the editor: what is
 * blocking each of its topics, and the way to the map.
 */
export function LockedQuestion({ title, difficulty, blockers }: { title: string; difficulty: Difficulty; blockers: LockedTopicBlocker[] }) {
  return (
    <main className={s.locked}>
      <section className={s.lockedCard} aria-labelledby="locked-title" data-testid="locked-question">
        <span className={s.lockedIcon} aria-hidden="true">
          <Icon name="lock" size={20} />
        </span>
        <div>
          <h1 id="locked-title" className={s.lockedTitle}>
            {title}
          </h1>
          <div style={{ marginTop: 8 }}>
            <DifficultyPill level={difficulty} />
          </div>
          <p className={s.lockedLead}>
            This question builds on {blockers.length === 1 ? 'a topic' : 'topics'} you haven’t unlocked yet. Earn tokens on open topics,
            then spend them on the map.
          </p>
        </div>
        <ul className={s.blockers}>
          {blockers.map((b) => (
            <li key={b.topic.id} className={s.blocker}>
              <span className={s.blockerHead}>
                <Icon name={b.topic.icon} size={14} /> {b.topic.title}
              </span>
              <BlockerBody b={b} />
            </li>
          ))}
        </ul>
        <div className={s.actions}>
          <ButtonLink href="/map" variant="primary" icon="map">
            Open the map
          </ButtonLink>
          <ButtonLink href="/problems" variant="ghost" icon="list">
            Back to problems
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
