import Link from 'next/link';
import type { ReactNode } from 'react';
import { plural } from '@/components/Loop/awards';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Progress } from '@/components/ui/Progress';
import { DIFFICULTIES } from '@/lib/types';
import type { EarnOption, RecipeCard, TopicBlockerView, TopicCardView } from '@/lib/server/loopViews';
import { StateLabel } from './StateLabel';
import { TopicActions, type BalanceIndex } from './TopicActions';
import { ProblemList } from './TopicProblems';
import { TopicThumb } from './TopicThumb';
import s from './map.module.css';

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
      {options.map((o) => (
        <li key={o.slug}>
          <Link href={`/problems/${o.slug}`} className={`${s.earnLink} focus-ring`}>
            <span>{o.title}</span>
            <span className={s.earnAmount}>+{o.amount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * What stands between this topic and an unlock, for a topic in an open tier
 * that is short of tokens: the cheapest recipe, what it still lacks and the
 * problems that pay it. (A closed tier says why once, at the tier — not on
 * every topic — and a topic that is ready has its button.)
 */
function Blocker({ blocker, topicTitle }: { blocker: TopicBlockerView; topicTitle: string }) {
  if (blocker.kind === 'no_recipe') {
    return <p className={s.blockerText}>{topicTitle} has no unlock recipe yet.</p>;
  }
  if (blocker.kind !== 'recipe') return null;
  const missing = blocker.items.filter((i) => i.missing > 0);
  return (
    <div className={s.blocker} data-testid="blocker">
      <p className={s.label}>What’s blocking you</p>
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
 * "Tokens: 2 Easy · 1 Medium" — the split of a balance, only where it tells
 * something the total in the row does not: the buckets that hold anything,
 * and only when there is more than one (recipes ask for a minimum difficulty).
 */
function tokenSplit(balance: TopicCardView['balance']): string | null {
  const held = DIFFICULTIES.filter((d) => (balance.byDifficulty[d] ?? 0) > 0);
  if (held.length < 2) return null;
  return `Tokens: ${held.map((d) => `${balance.byDifficulty[d]} ${d}`).join(' · ')}`;
}

/** The quiet line at the top of an open topic: how it was unlocked, what its tokens are made of. */
function Facts({ topic }: { topic: TopicCardView }) {
  const facts = [topic.viaRecipe ? `Unlocked with “${topic.viaRecipe}”` : null, tokenSplit(topic.balance)].filter(Boolean);
  if (facts.length === 0) return null;
  return <p className={s.facts}>{facts.join(' · ')}</p>;
}

/**
 * One topic of a tier: a row with its poster, its name and the one thing a
 * learner wants to know about it. What that is follows its state —
 *
 *  - unlocked: how many problems are solved (and the tokens it holds, once
 *    it holds any); the row opens to its problems;
 *  - ready to unlock: the label and the Unlock button;
 *  - short of tokens (tier open): how many more it needs; the row opens to
 *    what is blocking it and its recipes;
 *  - in a closed tier: its summary and how many problems it holds — the tier
 *    says why it is closed, once;
 *  - without a recipe: a note.
 *
 * Only an unlocked or short-of-tokens topic opens: a disclosure (<details>,
 * keyboard-operable, no script) whose summary is the whole row. `defaultOpen`
 * opens the problems of the topic the hero is about.
 */
export function TopicCard({
  topic,
  balances,
  defaultOpen = false,
  inClosedTier = false,
}: {
  topic: TopicCardView;
  balances: BalanceIndex;
  defaultOpen?: boolean;
  inClosedTier?: boolean;
}) {
  const titleId = `topic-${topic.slug}-title`;
  const { state } = topic;
  const { total, solved } = topic.problems;

  let marker: ReactNode = null;
  let meta: ReactNode = null;
  let body: ReactNode = null;
  if (state === 'unlocked') {
    meta =
      total === 0 ? (
        <>No problems yet</>
      ) : (
        <>
          <span className="mono">
            {solved}/{total}
          </span>{' '}
          solved
          {topic.balance.total > 0 && <> · {plural(topic.balance.total, 'token')}</>}
        </>
      );
    if (total > 0) {
      body = (
        <>
          <p className={s.summary}>{topic.summary}</p>
          <Facts topic={topic} />
          <ProblemList problems={topic.problems.list} label={`${topic.title} problems`} />
        </>
      );
    }
  } else if (state === 'unlockable') {
    marker = <StateLabel kind="ready" data-testid="topic-state" />;
    meta = <>{plural(total, 'problem')}</>;
  } else if (state === 'needs_tokens') {
    marker = <StateLabel kind="locked" data-testid="topic-state" />;
    const need = topic.blocker?.kind === 'recipe' ? topic.blocker.missing : null;
    meta = need != null ? <>Needs {plural(need, 'more token')}</> : <>{plural(total, 'problem')}</>;
    body = (
      <>
        <p className={s.summary}>{topic.summary}</p>
        {topic.blocker && <Blocker blocker={topic.blocker} topicTitle={topic.title} />}
        {topic.recipes.length > 0 && (
          <div className={s.recipesBlock}>
            <p className={s.label}>{topic.recipes.length === 1 ? 'Recipe' : `Recipes (${topic.recipes.length})`} — spend any one</p>
            <RecipeList recipes={topic.recipes} />
          </div>
        )}
      </>
    );
  } else if (state === 'no_recipe') {
    marker = <StateLabel kind="locked" data-testid="topic-state" />;
    meta = <>No unlock recipe yet</>;
  } else {
    // tier_closed: the tier says it once
    meta = <>{total === 0 ? 'No problems yet' : plural(total, 'problem')}</>;
  }

  const head = (
    <div className={s.rowHead}>
      <TopicThumb slug={topic.slug} state={state} />
      <div className={s.rowText}>
        <div className={s.rowTitleLine}>
          <h3 className={s.topicTitle} id={titleId} tabIndex={-1}>
            {topic.title}
          </h3>
          {marker}
        </div>
        {inClosedTier && <p className={s.rowSummary}>{topic.summary}</p>}
      </div>
      <div className={s.rowMeta} data-testid="topic-problems">
        {meta}
      </div>
      {body && (
        <span className={s.chev} aria-hidden="true">
          <Icon name="chev-down" size={16} />
        </span>
      )}
    </div>
  );

  return (
    <article className={s.topic} data-state={state} data-card="" id={`topic-${topic.slug}`} aria-labelledby={titleId} data-testid={`topic-${topic.slug}`}>
      {body ? (
        <details className={s.rowDetails} open={defaultOpen || undefined}>
          <summary className={s.rowSummaryBar}>{head}</summary>
          <div className={s.rowBody}>{body}</div>
        </details>
      ) : (
        <div className={s.rowStatic}>{head}</div>
      )}
      <TopicActions
        topic={{ id: topic.id, title: topic.title, state }}
        recipes={topic.recipes}
        balances={balances}
        titleId={titleId}
      />
    </article>
  );
}
