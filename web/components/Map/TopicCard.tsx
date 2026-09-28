import Link from 'next/link';
import type { ReactNode } from 'react';
import { Countdown } from '@/components/Loop/Countdown';
import { TokenBuckets } from '@/components/Loop/TokenBuckets';
import { plural } from '@/components/Loop/awards';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { Progress } from '@/components/ui/Progress';
import type { EarnOption, RecipeCard, TopicBlockerView, TopicCardState, TopicCardView } from '@/lib/server/loopViews';
import { TopicActions, type BalanceIndex } from './TopicActions';
import s from './map.module.css';

const STATE: Record<TopicCardState, { label: string; tone: PillTone; icon: IconName }> = {
  unlocked: { label: 'Unlocked', tone: 'ok', icon: 'lock-open' },
  unlockable: { label: 'Ready to unlock', tone: 'accent', icon: 'sparkle' },
  needs_tokens: { label: 'Needs tokens', tone: 'warn', icon: 'coin' },
  tier_closed: { label: 'Tier closed', tone: 'muted', icon: 'lock' },
  no_recipe: { label: 'Locked', tone: 'muted', icon: 'lock' },
};

export function TopicStatePill({ state, free }: { state: TopicCardState; free?: boolean }) {
  const m = STATE[state];
  return (
    <Pill tone={m.tone} size="xs" icon={free ? 'check' : m.icon} data-testid="topic-state">
      {free ? 'Free' : m.label}
    </Pill>
  );
}

const minText = (d: string) => (d === 'Easy' ? '' : ` (${d}+)`);

function EarnLinks({ options }: { options: EarnOption[] }) {
  if (options.length === 0) {
    return <p className={s.blockerText}>No open problem pays these yet — see if another recipe is closer.</p>;
  }
  return (
    <ul className={s.earn} aria-label="Ways to earn it">
      <li className={s.earnLabel} aria-hidden="true">
        Earn it:
      </li>
      {options.map((o) =>
        o.kind === 'question' ? (
          <li key={`q-${o.slug}`}>
            <Link href={`/problems/${o.slug}`} className={`${s.earnLink} focus-ring`}>
              <span>{o.title}</span>
              <span className={s.earnAmount}>+{o.amount}</span>
            </Link>
          </li>
        ) : (
          <li key={`b-${o.stepId}`}>
            <Link href={`/queue?step=${encodeURIComponent(o.stepId)}`} className={`${s.earnLink} focus-ring`} title={`Build step of ${o.componentTitle}`}>
              <Icon name="puzzle" size={11} />
              <span>{o.componentTitle}</span>
              <span className={s.earnAmount}>+{o.amount}</span>
            </Link>
          </li>
        )
      )}
    </ul>
  );
}

function Blocker({ blocker, topicTitle }: { blocker: TopicBlockerView; topicTitle: string }) {
  if (blocker.kind === 'no_recipe') {
    return (
      <div className={s.blocker} data-kind="gate">
        <p className={s.label}>
          <Icon name="lock" size={12} /> What’s blocking you
        </p>
        <p className={s.blockerText}>{topicTitle} has no unlock recipe yet.</p>
      </div>
    );
  }

  if (blocker.kind === 'gate') {
    const g = blocker.gate;
    let detail: ReactNode;
    if (!g) detail = <>It has no gate yet.</>;
    else if (g.state === 'eligible')
      detail = (
        <>
          Pass the{' '}
          <a href={`#gate-${g.id}`} className={`${s.inlineLink} focus-ring`}>
            {g.title}
          </a>{' '}
          to open it — you can take it now.
        </>
      );
    else if (g.state === 'running')
      detail = (
        <>
          Your {g.title} attempt is running —{' '}
          <Link href={`/map/gates/${g.attemptId}`} className={`${s.inlineLink} focus-ring`}>
            continue it
          </Link>
          .
        </>
      );
    else if (g.state === 'cooldown' && g.nextEligibleAt)
      detail = (
        <>
          The {g.title} is cooling down — retry in <Countdown to={g.nextEligibleAt} expiredText="a moment" />.
        </>
      );
    else if (g.state === 'previous_tier_closed')
      detail = blocker.previousTier ? (
        <>
          Open{' '}
          <a href={`#tier-${blocker.previousTier.slug}`} className={`${s.inlineLink} focus-ring`}>
            {blocker.previousTier.title}
          </a>{' '}
          first, then pass the {g.title}.
        </>
      ) : (
        <>Open the tier before it first, then pass the {g.title}.</>
      );
    else detail = <>Pass the {g.title} to open it.</>;
    return (
      <div className={s.blocker} data-kind="gate" data-testid="blocker">
        <p className={s.label}>
          <Icon name="shield" size={12} /> What’s blocking you
        </p>
        <p className={s.blockerText}>
          <strong>{blocker.tier.title}</strong> is closed. {detail}
        </p>
      </div>
    );
  }

  if (blocker.ready) {
    return (
      <div className={s.blocker} data-kind="ready" data-testid="blocker">
        <p className={s.label}>
          <Icon name="sparkle" size={12} /> Ready
        </p>
        <p className={s.blockerText}>
          You hold enough for <strong>{blocker.recipeTitle}</strong> — spend it to open {topicTitle}.
        </p>
      </div>
    );
  }

  const missing = blocker.items.filter((i) => i.missing > 0);
  return (
    <div className={s.blocker} data-kind="recipe" data-testid="blocker">
      <p className={s.label}>
        <Icon name="coin" size={12} /> What’s blocking you
      </p>
      <p className={s.blockerText}>
        Cheapest recipe, <strong>{blocker.recipeTitle}</strong>: {plural(blocker.missing, 'more token')}.
      </p>
      <ul className={s.missingList}>
        {missing.map((it) => (
          <li key={`${it.topic.id}-${it.minDifficulty}`} className={s.missing}>
            <span className={s.missingHead}>
              <strong>
                {it.missing} {it.topic.title}
              </strong>
              {minText(it.minDifficulty)} — you have {it.have} of {it.need}
            </span>
            <EarnLinks options={it.earn} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecipeList({ recipes }: { recipes: RecipeCard[] }) {
  return (
    <ul className={s.recipes}>
      {recipes.map((r) => (
        <li key={r.id} className={s.recipe} data-ready={r.ready} data-testid="recipe">
          <div className={s.recipeHead}>
            <span className={s.recipeTitle}>{r.title}</span>
            {r.ready ? (
              <Pill tone="ok" size="xs" icon="check">
                Ready
              </Pill>
            ) : (
              <Pill tone="muted" size="xs">
                {r.missing} missing
              </Pill>
            )}
          </div>
          <ul className={s.items}>
            {r.items.map((it) => {
              const met = it.missing === 0;
              return (
                <li key={`${it.topic.id}-${it.minDifficulty}`} className={s.item} data-met={met}>
                  <span className={s.itemName}>
                    <Icon name={it.topic.icon} size={12} />
                    <span className={s.itemTitle}>{it.topic.title}</span>
                    {it.minDifficulty !== 'Easy' && <span className={s.minTag}>{it.minDifficulty}+</span>}
                  </span>
                  <Progress value={Math.min(it.have, it.need)} max={it.need} tone={met ? 'ok' : 'warn'} />
                  <span className={s.itemCount}>
                    {Math.min(it.have, it.need)}/{it.need}
                    <span className="sr-only">
                      {' '}
                      {it.topic.title} tokens{minText(it.minDifficulty)}
                      {met ? ', enough' : `, ${it.missing} missing`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * One topic on the map: its state, token balance by difficulty bucket,
 * what's blocking it (the gate, or the cheapest recipe's missing tokens
 * with ways to earn them), its recipes with have/need per item, and the
 * unlock action.
 */
export function TopicCard({ topic, free, balances }: { topic: TopicCardView; free: boolean; balances: BalanceIndex }) {
  const titleId = `topic-${topic.slug}-title`;
  const showRecipes = topic.state !== 'unlocked' && topic.recipes.length > 0;
  return (
    <article className={s.topic} data-state={topic.state} id={`topic-${topic.slug}`} aria-labelledby={titleId} data-testid={`topic-${topic.slug}`}>
      <header className={s.topicHead}>
        <span className={s.topicIcon} aria-hidden="true">
          <Icon name={topic.icon} size={17} />
        </span>
        <div className={s.topicHeadText}>
          <h3 className={s.topicTitle} id={titleId} tabIndex={-1}>
            {topic.title}
          </h3>
          <TopicStatePill state={topic.state} free={free} />
        </div>
      </header>
      <p className={s.topicSummary}>{topic.summary}</p>
      <TokenBuckets balance={topic.balance} label={`${topic.title} tokens`} />
      {topic.state === 'unlocked' && topic.viaRecipe && (
        <p className={s.topicNote}>
          <Icon name="check-circle" size={12} /> Unlocked with “{topic.viaRecipe}”
        </p>
      )}
      {topic.blocker && <Blocker blocker={topic.blocker} topicTitle={topic.title} />}
      {showRecipes && (
        <details className={s.recipesToggle} open={topic.state !== 'tier_closed'}>
          <summary className="focus-ring">
            <Icon name="chev-right" size={12} />
            {topic.recipes.length === 1 ? 'Recipe' : `Recipes (${topic.recipes.length})`} — spend any one
          </summary>
          <RecipeList recipes={topic.recipes} />
        </details>
      )}
      <TopicActions
        topic={{ id: topic.id, slug: topic.slug, title: topic.title, state: topic.state }}
        recipes={topic.recipes}
        balances={balances}
        titleId={titleId}
      />
    </article>
  );
}
