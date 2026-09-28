/**
 * Validation and cost preview for one topic's unlock recipes, as edited in
 * the recipe editor. Pure; unit-tested in admin/test/recipe-checks.test.ts.
 *
 * The rules mirror the seed validator (web/prisma/seed/validate.ts) so the
 * database never gets a recipe set the seed would have refused:
 *   errors (block saving)
 *     · untitled recipe, recipe without items
 *     · item without a token topic, unknown topic, quantity not an integer ≥ 1,
 *       missing min difficulty
 *     · an item that spends the recipe's own topic (those tokens only exist
 *       after the unlock)
 *     · a tier > 0 topic left without any recipe
 *     · the topic, or any other topic, becoming impossible to unlock
 *       (tokens are only earned from unlocked topics)
 *   warnings
 *     · recipes on a free-tier topic (never used)
 *     · the same token topic twice in one recipe, a token topic from a higher tier
 *     · a recipe needing more tokens than the published content pays out
 */
import {
  cheapestRecipe,
  DIFFICULTIES,
  planDebits,
  qualifyingBalance,
  recipeProgress,
  type Balances,
  type Difficulty,
  type Requirement,
} from './rules';

export interface TopicInfo {
  id: string;
  slug: string;
  title: string;
  tierOrd: number;
}

export interface ItemDraft {
  /** Stable client-side key (new rows have no id yet). */
  key: string;
  id?: string;
  tokenTopicId: string | null;
  quantity: number | null;
  minDifficulty: Difficulty | null;
}

export interface RecipeDraft {
  key: string;
  id?: string;
  title: string;
  items: ItemDraft[];
}

/** A saved recipe reduced to what reachability needs. */
export interface RecipeShape {
  items: readonly { tokenTopicId: string }[];
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  message: string;
  recipeKey?: string;
  itemKey?: string;
}

export interface CheckInput {
  topic: TopicInfo;
  draft: readonly RecipeDraft[];
  topics: readonly TopicInfo[];
  /** Saved recipes of every topic (the edited one included), by topic id. */
  saved: ReadonlyMap<string, readonly RecipeShape[]>;
  /** Tokens the published content pays out, per topic and difficulty. */
  supply?: Balances;
}

const isValidQuantity = (q: number | null): q is number => q !== null && Number.isInteger(q) && q >= 1;

function itemIsComplete(it: ItemDraft): it is ItemDraft & { tokenTopicId: string; quantity: number; minDifficulty: Difficulty } {
  return !!it.tokenTopicId && isValidQuantity(it.quantity) && !!it.minDifficulty && DIFFICULTIES.includes(it.minDifficulty);
}

export function requirementsOf(recipe: RecipeDraft): Requirement[] {
  return recipe.items.filter(itemIsComplete).map((it) => ({
    topicId: it.tokenTopicId,
    quantity: it.quantity,
    minDifficulty: it.minDifficulty,
  }));
}

/**
 * Topics that can ever be unlocked: the free tier, then (fixpoint) every
 * topic with a recipe whose token topics are all unlockable. Same rule as the
 * seed validator.
 */
export function unlockableTopics(
  topics: readonly TopicInfo[],
  recipesOf: (topicId: string) => readonly RecipeShape[]
): Set<string> {
  const ok = new Set(topics.filter((t) => t.tierOrd === 0).map((t) => t.id));
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of topics) {
      if (ok.has(t.id)) continue;
      if (recipesOf(t.id).some((r) => r.items.every((it) => ok.has(it.tokenTopicId)))) {
        ok.add(t.id);
        changed = true;
      }
    }
  }
  return ok;
}

const titleList = (ts: readonly TopicInfo[]) => ts.map((t) => t.title).join(', ');
const recipeLabel = (r: RecipeDraft, i: number) => (r.title.trim() ? `“${r.title.trim()}”` : `Recipe ${i + 1}`);

export function checkTopicRecipes(input: CheckInput): Issue[] {
  const { topic, draft, topics, saved, supply } = input;
  const byId = new Map(topics.map((t) => [t.id, t]));
  const issues: Issue[] = [];
  const add = (severity: Severity, message: string, recipeKey?: string, itemKey?: string) =>
    issues.push({ severity, message, recipeKey, itemKey });

  if (topic.tierOrd === 0 && draft.length > 0) {
    add('warning', `${topic.title} is in the free tier, which is always unlocked, so these recipes are never used.`);
  }
  if (topic.tierOrd > 0 && draft.length === 0) {
    add('error', `${topic.title} needs at least one recipe; without one it can never be unlocked.`);
  }

  draft.forEach((r, i) => {
    const label = recipeLabel(r, i);
    if (!r.title.trim()) add('error', 'Give this recipe a title.', r.key);
    if (r.items.length === 0) add('error', `${label} has no items, so it would unlock ${topic.title} for free.`, r.key);

    const counts = new Map<string, number>();
    for (const it of r.items) {
      const token = it.tokenTopicId ? byId.get(it.tokenTopicId) : undefined;
      if (!it.tokenTopicId) add('error', 'Pick the topic whose tokens this item spends.', r.key, it.key);
      else if (!token) add('error', 'This token topic does not exist (anymore).', r.key, it.key);
      else if (token.id === topic.id) {
        add(
          'error',
          `A recipe for ${topic.title} cannot spend ${topic.title} tokens: they are only earned once it is unlocked.`,
          r.key,
          it.key
        );
      } else if (token.tierOrd > topic.tierOrd) {
        add(
          'warning',
          `${token.title} is in tier ${token.tierOrd}, above ${topic.title} (tier ${topic.tierOrd}); learners only earn those tokens later.`,
          r.key,
          it.key
        );
      }
      if (!isValidQuantity(it.quantity)) add('error', 'Quantity must be a whole number of at least 1.', r.key, it.key);
      if (!it.minDifficulty || !DIFFICULTIES.includes(it.minDifficulty)) {
        add('error', 'Pick the minimum difficulty the tokens must come from.', r.key, it.key);
      }
      if (token) counts.set(token.id, (counts.get(token.id) ?? 0) + 1);
    }
    for (const [topicId, n] of counts) {
      if (n > 1) {
        add('warning', `${byId.get(topicId)?.title ?? topicId} appears ${n} times in ${label}; one item with the combined quantity reads more clearly.`, r.key);
      }
    }
  });

  // Reachability: compare the saved state with the draft substituted in.
  const draftShapes: RecipeShape[] = draft.map((r) => ({
    items: r.items.filter((it) => !!it.tokenTopicId).map((it) => ({ tokenTopicId: it.tokenTopicId as string })),
  }));
  const before = unlockableTopics(topics, (id) => saved.get(id) ?? []);
  const after = unlockableTopics(topics, (id) => (id === topic.id ? draftShapes : (saved.get(id) ?? [])));
  if (topic.tierOrd > 0 && draft.length > 0 && !after.has(topic.id)) {
    add('error', `${topic.title} could never be unlocked: every recipe needs tokens of a topic that is itself still locked.`);
  }
  const lost = topics.filter((t) => t.id !== topic.id && before.has(t.id) && !after.has(t.id));
  if (lost.length > 0) {
    add('error', `This change would make ${titleList(lost)} impossible to unlock: their recipes rely on ${topic.title}.`);
  }

  // Affordability against what all published questions and build steps pay out.
  if (supply && topic.tierOrd > 0) {
    let affordable = 0;
    draft.forEach((r, i) => {
      const reqs = requirementsOf(r);
      if (reqs.length === 0 || reqs.length !== r.items.length) return;
      const plan = planDebits(supply, reqs);
      if (plan.ok) {
        affordable++;
        return;
      }
      const short = plan.shortfalls
        .map((s) => `${byId.get(s.topicId)?.title ?? s.topicId} ${s.minDifficulty}+ (${s.have} of ${s.need})`)
        .join(', ');
      add('warning', `${recipeLabel(r, i)} needs more tokens than the published content pays out: ${short}.`, r.key);
    });
    if (draft.length > 0 && affordable === 0) {
      add('warning', `No recipe of ${topic.title} fits in what the published content pays out; add questions or lower a quantity.`);
    }
  }

  return issues;
}

export interface CostLine {
  itemKey: string;
  text: string;
  /** Qualifying tokens all published content pays out for this item. */
  onOffer?: number;
}

export interface RecipeCost {
  recipeKey: string;
  totalTokens: number;
  lines: CostLine[];
  /** The recipe a learner with no tokens is pointed at (§3.4 cheapest recipe). */
  cheapest: boolean;
  /** Whether the published content pays out enough to spend it (undefined: no supply data). */
  affordable?: boolean;
}

/** What each recipe costs: token total, per-item breakdown, cheapest marker. */
export function recipeCosts(
  draft: readonly RecipeDraft[],
  topics: readonly TopicInfo[],
  supply?: Balances
): RecipeCost[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const progress = draft.map((r, ord) =>
    recipeProgress(
      {
        id: r.key,
        title: r.title,
        ord,
        items: requirementsOf(r).map((q) => ({ tokenTopicId: q.topicId, quantity: q.quantity, minDifficulty: q.minDifficulty })),
      },
      {}
    )
  );
  const cheapest = cheapestRecipe(progress.filter((p, i) => p.totalQuantity > 0 && draft[i].items.length > 0));

  return draft.map((r, i) => {
    const complete = requirementsOf(r).length === r.items.length && r.items.length > 0;
    return {
      recipeKey: r.key,
      totalTokens: progress[i].totalQuantity,
      cheapest: cheapest?.recipeId === r.key,
      affordable: supply && complete ? planDebits(supply, requirementsOf(r)).ok : undefined,
      lines: r.items.map((it) => {
        const name = (it.tokenTopicId && byId.get(it.tokenTopicId)?.title) || '…';
        const floor = it.minDifficulty === 'Easy' ? 'any difficulty' : `${it.minDifficulty ?? '…'} or harder`;
        return {
          itemKey: it.key,
          text: `${it.quantity ?? '…'} × ${name}, ${floor}`,
          onOffer:
            supply && it.tokenTopicId && it.minDifficulty
              ? qualifyingBalance(supply, it.tokenTopicId, it.minDifficulty)
              : undefined,
        };
      }),
    };
  });
}
