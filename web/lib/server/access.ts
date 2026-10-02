import 'server-only';
import type { Difficulty } from '@/lib/types';
import { prisma, withUserLock, type Db } from './db';
import { evaluateBadges, type AwardedBadge } from './badges';
import { AccessDenied, InsufficientTokens, InvalidInput, NotFoundError, TierLocked } from './errors';
import { getGateStatuses, getRunningAttemptForQuestion, type GateStatus } from './gates';
import { getBalances, spend, type Debit } from './ledger';
import { hasRole } from './rules/roles';
import {
  cheapestRecipe,
  compareRecipeProgress,
  planDebits,
  recipeProgress,
  recipeRequirements,
  type Balances,
  type RecipeInput,
  type RecipeItemProgress,
} from './rules/recipes';
import { getOpenTierIds, getUnlockedTopicIds } from './unlocks';

export { isTierOpen, isTopicUnlocked, getOpenTierIds, getUnlockedTopicIds } from './unlocks';

/**
 * Unlocks and access (spec §3.4): recipe unlocks, "what's blocking you",
 * the /map state, and the question access checks.
 */

export interface TopicRef {
  id: string;
  slug: string;
  title: string;
  icon: string;
}

export interface TierRef {
  id: string;
  ord: number;
  slug: string;
  title: string;
}

/** A recipe item's progress, with the token topic spelled out. */
export interface RecipeItemView extends RecipeItemProgress {
  topic: TopicRef;
}

export interface RecipeView {
  recipeId: string;
  title: string;
  ord: number;
  items: RecipeItemView[];
  /** Σ per-item missing tokens; 0 ⇔ spendable now. */
  missing: number;
  totalQuantity: number;
  ready: boolean;
}

/**
 * Why a topic is locked:
 *   gate      — its tier is closed; `gate` carries eligibility / cooldown
 *               (null only if content forgot the tier's gate)
 *   recipe    — tier open, tokens missing (or `cheapest.ready`: spend it)
 *   no_recipe — tier open but the topic has no recipe (content bug)
 */
export type Blocker =
  | { kind: 'gate'; tier: TierRef; gate: GateStatus | null }
  | { kind: 'recipe'; cheapest: RecipeView; recipes: RecipeView[] }
  | { kind: 'no_recipe' };

/** unlocked · unlockable (tier open and a recipe is ready) · locked. */
export type TopicStatus = 'unlocked' | 'unlockable' | 'locked';

export interface MapTopic extends TopicRef {
  summary: string;
  ord: number;
  status: TopicStatus;
  /** Free tier-0 topics are unlocked implicitly: `unlock` is null. */
  unlock: { at: Date; viaRecipeId: string | null } | null;
  /** Tokens of this topic the user holds. */
  balance: { total: number; byDifficulty: Record<Difficulty, number> };
  /** Every recipe (cheapest first). Empty for tier 0. */
  recipes: RecipeView[];
  /** null when unlocked. */
  blocker: Blocker | null;
}

export interface MapTier extends TierRef {
  summary: string;
  open: boolean;
  /** The gate that opens this tier (null for tier 0). */
  gate: GateStatus | null;
  topics: MapTopic[];
}

export interface MapState {
  tiers: MapTier[];
}

// ─── shared shaping ──────────────────────────────────────────────────────

const recipeInclude = {
  orderBy: { ord: 'asc' as const },
  select: {
    id: true,
    title: true,
    ord: true,
    items: {
      orderBy: { id: 'asc' as const },
      select: {
        tokenTopicId: true,
        quantity: true,
        minDifficulty: true,
        tokenTopic: { select: { id: true, slug: true, title: true, icon: true } },
      },
    },
  },
};

type RecipeRow = {
  id: string;
  title: string;
  ord: number;
  items: {
    tokenTopicId: string;
    quantity: number;
    minDifficulty: Difficulty;
    tokenTopic: TopicRef;
  }[];
};

function toRecipeInput(r: RecipeRow): RecipeInput {
  return {
    id: r.id,
    title: r.title,
    ord: r.ord,
    items: r.items.map((i) => ({ tokenTopicId: i.tokenTopicId, quantity: i.quantity, minDifficulty: i.minDifficulty })),
  };
}

/** Recipe progress for every recipe, cheapest first. */
function recipeViews(recipes: RecipeRow[], balances: Balances): RecipeView[] {
  return recipes
    .map((r) => {
      const p = recipeProgress(toRecipeInput(r), balances);
      return {
        recipeId: p.recipeId,
        title: p.title,
        ord: p.ord,
        missing: p.missing,
        totalQuantity: p.totalQuantity,
        ready: p.ready,
        items: p.items.map((it, i) => ({ ...it, topic: r.items[i].tokenTopic })),
      };
    })
    .sort(compareRecipeProgress);
}

function blockerFor(input: {
  unlocked: boolean;
  tierOpen: boolean;
  tier: TierRef;
  gate: GateStatus | null;
  recipes: RecipeView[];
}): Blocker | null {
  if (input.unlocked) return null;
  if (!input.tierOpen) return { kind: 'gate', tier: input.tier, gate: input.gate };
  const cheapest = input.recipes[0];
  if (!cheapest) return { kind: 'no_recipe' };
  return { kind: 'recipe', cheapest, recipes: input.recipes };
}

function balanceOf(balances: Balances, topicId: string) {
  const b = balances[topicId] ?? {};
  const byDifficulty = {
    Easy: Math.max(0, b.Easy ?? 0),
    Medium: Math.max(0, b.Medium ?? 0),
    Hard: Math.max(0, b.Hard ?? 0),
  };
  return { total: byDifficulty.Easy + byDifficulty.Medium + byDifficulty.Hard, byDifficulty };
}

// ─── /map ────────────────────────────────────────────────────────────────

/**
 * Everything the tier map renders: every tier (with its gate status) and
 * every topic (status, balance, recipes with per-item have/need, blocker).
 * Lazily finishes expired gate attempts first.
 */
export async function getMapState(userId: string, now: Date = new Date()): Promise<MapState> {
  const gateStatuses = await getGateStatuses(userId, { now });
  const [tiers, openTierIds, topicUnlocks, balances] = await Promise.all([
    prisma.tier.findMany({
      orderBy: { ord: 'asc' },
      select: {
        id: true,
        ord: true,
        slug: true,
        title: true,
        summary: true,
        gate: { select: { id: true } },
        topics: {
          orderBy: { ord: 'asc' },
          select: { id: true, slug: true, title: true, summary: true, icon: true, ord: true, recipes: recipeInclude },
        },
      },
    }),
    getOpenTierIds(userId),
    prisma.unlock.findMany({
      where: { userId, kind: 'topic' },
      select: { refId: true, createdAt: true, viaRecipeId: true },
    }),
    getBalances(userId),
  ]);
  const unlockByTopic = new Map(topicUnlocks.map((u) => [u.refId, u]));

  return {
    tiers: tiers.map((tier) => {
      const open = openTierIds.has(tier.id);
      const gate = tier.gate ? gateStatuses.get(tier.gate.id) ?? null : null;
      const tierRef: TierRef = { id: tier.id, ord: tier.ord, slug: tier.slug, title: tier.title };
      return {
        ...tierRef,
        summary: tier.summary,
        open,
        gate,
        topics: tier.topics.map((t) => {
          const row = unlockByTopic.get(t.id);
          const unlocked = tier.ord === 0 || row !== undefined;
          const recipes = tier.ord === 0 ? [] : recipeViews(t.recipes, balances);
          const blocker = blockerFor({ unlocked, tierOpen: open, tier: tierRef, gate, recipes });
          const status: TopicStatus = unlocked
            ? 'unlocked'
            : blocker?.kind === 'recipe' && blocker.cheapest.ready
              ? 'unlockable'
              : 'locked';
          return {
            id: t.id,
            slug: t.slug,
            title: t.title,
            icon: t.icon,
            summary: t.summary,
            ord: t.ord,
            status,
            unlock: row ? { at: row.createdAt, viaRecipeId: row.viaRecipeId } : null,
            balance: balanceOf(balances, t.id),
            recipes,
            blocker,
          };
        }),
      };
    }),
  };
}

/** What stands between the user and `topicId` — null when it is unlocked. */
export async function whatsBlocking(userId: string, topicId: string, now: Date = new Date()): Promise<Blocker | null> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      tier: { select: { id: true, ord: true, slug: true, title: true, gate: { select: { id: true } } } },
      recipes: recipeInclude,
    },
  });
  if (!topic) throw new NotFoundError('topic', topicId);
  const { tier } = topic;
  if (tier.ord === 0) return null;
  const row = await prisma.unlock.findUnique({
    where: { userId_kind_refId: { userId, kind: 'topic', refId: topicId } },
    select: { id: true },
  });
  if (row) return null;

  const openTierIds = await getOpenTierIds(userId);
  const tierRef: TierRef = { id: tier.id, ord: tier.ord, slug: tier.slug, title: tier.title };
  if (!openTierIds.has(tier.id)) {
    const gate = tier.gate ? (await getGateStatuses(userId, { now })).get(tier.gate.id) ?? null : null;
    return { kind: 'gate', tier: tierRef, gate };
  }
  const tokenTopicIds = [...new Set(topic.recipes.flatMap((r) => r.items.map((i) => i.tokenTopicId)))];
  const balances = await getBalances(userId, { topicIds: tokenTopicIds });
  return blockerFor({ unlocked: false, tierOpen: true, tier: tierRef, gate: null, recipes: recipeViews(topic.recipes, balances) });
}

// ─── Unlocking ───────────────────────────────────────────────────────────

export interface UnlockResult {
  status: 'unlocked' | 'already_unlocked';
  topicId: string;
  /** The recipe spent (null when nothing was spent). */
  recipeId: string | null;
  debits: Debit[];
  badgesAwarded: AwardedBadge[];
}

/**
 * Unlock a topic by spending one of its recipes — `recipeId`, or the
 * cheapest ready one when omitted. Atomic: the spend (spec §3.3) and the
 * unlocks row commit together under the user's lock. Idempotent for an
 * already-unlocked (or free tier-0) topic.
 *
 * Throws TierLocked (tier closed), InsufficientTokens (nothing written),
 * NotFoundError (topic / recipe of another topic).
 */
export async function unlockTopic(userId: string, topicId: string, recipeId?: string): Promise<UnlockResult> {
  const result = await withUserLock(userId, async (tx) => {
    const topic = await tx.topic.findUnique({
      where: { id: topicId },
      select: { id: true, tierId: true, tier: { select: { ord: true } }, recipes: recipeInclude },
    });
    if (!topic) throw new NotFoundError('topic', topicId);
    const none = { topicId, recipeId: null, debits: [] as Debit[] };
    if (topic.tier.ord === 0) return { status: 'already_unlocked' as const, ...none };

    const existing = await tx.unlock.findUnique({
      where: { userId_kind_refId: { userId, kind: 'topic', refId: topicId } },
      select: { id: true },
    });
    if (existing) return { status: 'already_unlocked' as const, ...none };

    const tierOpen = await tx.unlock.findUnique({
      where: { userId_kind_refId: { userId, kind: 'tier', refId: topic.tierId } },
      select: { id: true },
    });
    if (!tierOpen) throw new TierLocked(topic.tierId);

    let recipe: RecipeInput;
    if (recipeId) {
      const row = topic.recipes.find((r) => r.id === recipeId);
      if (!row) throw new NotFoundError('recipe', recipeId);
      recipe = toRecipeInput(row);
    } else {
      if (topic.recipes.length === 0) throw new InvalidInput('This topic has no unlock recipe.');
      const inputs = topic.recipes.map(toRecipeInput);
      const topicIds = [...new Set(inputs.flatMap((r) => r.items.map((i) => i.tokenTopicId)))];
      const balances = await getBalances(userId, { topicIds }, tx);
      const best = cheapestRecipe(inputs.map((r) => recipeProgress(r, balances)))!;
      recipe = inputs.find((r) => r.id === best.recipeId)!;
      if (!best.ready) {
        const plan = planDebits(balances, recipeRequirements(recipe));
        throw new InsufficientTokens(plan.ok ? [] : plan.shortfalls);
      }
    }

    const debits = await spend(
      userId,
      recipeRequirements(recipe),
      { reason: 'unlock', refType: 'recipe', refId: recipe.id },
      tx
    );
    await tx.unlock.create({ data: { userId, kind: 'topic', refId: topicId, viaRecipeId: recipe.id } });
    return { status: 'unlocked' as const, topicId, recipeId: recipe.id, debits };
  });

  const badgesAwarded = result.status === 'unlocked' ? await evaluateBadges(userId) : [];
  return { ...result, badgesAwarded };
}

// ─── Access checks ───────────────────────────────────────────────────────

export type QuestionAccess =
  | {
      ok: true;
      /** topics: every topic unlocked · gate_attempt: running gate attempt · author: own draft or staff */
      via: 'topics' | 'gate_attempt' | 'author';
      gateAttemptId?: string;
    }
  | { ok: false; reason: 'topic_locked'; lockedTopics: TopicRef[] }
  | { ok: false; reason: 'draft' };

/**
 * A question is accessible iff every one of its topics is unlocked — or it
 * belongs to a gate the user has a running attempt for. Drafts are only
 * reachable by their author and staff+. Throws NotFoundError.
 */
export async function canAccessQuestion(
  userId: string,
  questionId: string,
  now: Date = new Date(),
  db: Db = prisma
): Promise<QuestionAccess> {
  const q = await db.question.findUnique({
    where: { id: questionId },
    select: {
      status: true,
      authorId: true,
      topics: {
        select: {
          topic: { select: { id: true, slug: true, title: true, icon: true, tier: { select: { ord: true } } } },
        },
      },
    },
  });
  if (!q) throw new NotFoundError('question', questionId);

  if (q.status === 'draft') {
    if (q.authorId === userId) return { ok: true, via: 'author' };
    const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
    return hasRole(user?.role, 'staff') ? { ok: true, via: 'author' } : { ok: false, reason: 'draft' };
  }

  const gated = q.topics.map((t) => t.topic).filter((t) => t.tier.ord > 0);
  const rows = gated.length
    ? await db.unlock.findMany({
        where: { userId, kind: 'topic', refId: { in: gated.map((t) => t.id) } },
        select: { refId: true },
      })
    : [];
  const unlocked = new Set(rows.map((r) => r.refId));
  const locked = gated.filter((t) => !unlocked.has(t.id));
  if (locked.length === 0) return { ok: true, via: 'topics' };

  const attempt = await getRunningAttemptForQuestion(userId, questionId, now, db);
  if (attempt) return { ok: true, via: 'gate_attempt', gateAttemptId: attempt.id };
  return {
    ok: false,
    reason: 'topic_locked',
    lockedTopics: locked.map(({ id, slug, title, icon }) => ({ id, slug, title, icon })),
  };
}

/** canAccessQuestion, throwing AccessDenied / NotFoundError instead of returning `ok: false`. */
export async function assertCanAccessQuestion(userId: string, questionId: string, now: Date = new Date()) {
  const access = await canAccessQuestion(userId, questionId, now);
  if (!access.ok) {
    throw new AccessDenied(
      access.reason,
      access.reason === 'draft' ? 'This question is not published.' : 'Unlock this question’s topics on the map first.'
    );
  }
  return access;
}

/**
 * Accessibility of many questions at once — for the map's problem lists.
 * Same rules as canAccessQuestion except drafts count as accessible only to
 * their author. Unknown ids are omitted.
 */
export async function questionAccessMap(
  userId: string,
  questionIds: string[],
  now: Date = new Date()
): Promise<Map<string, boolean>> {
  if (questionIds.length === 0) return new Map();
  const [questions, rows, unlockedTopicIds, running] = await Promise.all([
    prisma.question.findMany({ where: { id: { in: questionIds } }, select: { id: true, status: true, authorId: true } }),
    prisma.questionTopic.findMany({ where: { questionId: { in: questionIds } }, select: { questionId: true, topicId: true } }),
    getUnlockedTopicIds(userId),
    prisma.gateAttempt.findMany({
      where: { userId, finishedAt: null, deadlineAt: { gt: now } },
      select: { gate: { select: { questions: { select: { questionId: true } } } } },
    }),
  ]);
  const inRunningGate = new Set(running.flatMap((a) => a.gate.questions.map((q) => q.questionId)));
  const topicsOf = new Map<string, string[]>();
  for (const r of rows) topicsOf.set(r.questionId, [...(topicsOf.get(r.questionId) ?? []), r.topicId]);
  return new Map(
    questions.map((q) => [
      q.id,
      q.status === 'draft'
        ? q.authorId === userId
        : (topicsOf.get(q.id) ?? []).every((t) => unlockedTopicIds.has(t)) || inRunningGate.has(q.id),
    ])
  );
}
