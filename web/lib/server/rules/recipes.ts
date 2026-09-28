/**
 * Pure token math (spec §3.1, §3.3, §3.4): balances, recipe progress, the
 * cheapest recipe, and debit planning. No DB — the ledger/access services
 * feed these with balances read from app.token_ledger.
 */
import { DIFFICULTIES, type Difficulty } from '@/lib/types';
import type { Shortfall } from '../errors';

export type { Shortfall };

/** Easy = 0, Medium = 1, Hard = 2. */
export function difficultyRank(d: Difficulty): number {
  return DIFFICULTIES.indexOf(d);
}

/** `d ≥ min` in Easy < Medium < Hard order. */
export function meetsMinDifficulty(d: Difficulty, min: Difficulty): boolean {
  return difficultyRank(d) >= difficultyRank(min);
}

/** Difficulties ≥ `min`, ascending (the order qualifying buckets are debited in). */
export function difficultiesFrom(min: Difficulty): Difficulty[] {
  return DIFFICULTIES.slice(difficultyRank(min));
}

/**
 * One user's bucket balances: topicId → source difficulty → SUM(amount).
 * Missing entries are 0. Plain object so it can cross the RSC boundary.
 */
export type Balances = Record<string, Partial<Record<Difficulty, number>>>;

/** Build `Balances` from grouped ledger rows. */
export function balancesFromRows(
  rows: Iterable<{ topicId: string; difficulty: Difficulty; amount: number }>
): Balances {
  const out: Balances = {};
  for (const r of rows) {
    const t = (out[r.topicId] ??= {});
    t[r.difficulty] = (t[r.difficulty] ?? 0) + r.amount;
  }
  return out;
}

/** Balance of one bucket. Never negative in practice; clamped defensively. */
export function bucketBalance(b: Balances, topicId: string, d: Difficulty): number {
  return Math.max(0, b[topicId]?.[d] ?? 0);
}

/** Topic balance = sum of its buckets. */
export function topicBalance(b: Balances, topicId: string): number {
  return DIFFICULTIES.reduce((sum, d) => sum + bucketBalance(b, topicId, d), 0);
}

/** Qualifying balance for a recipe item = sum of buckets with difficulty ≥ `min`. */
export function qualifyingBalance(b: Balances, topicId: string, min: Difficulty): number {
  return difficultiesFrom(min).reduce((sum, d) => sum + bucketBalance(b, topicId, d), 0);
}

// ─── Debit planning (spec §3.3) ──────────────────────────────────────────

/** "`quantity` tokens of `topicId` with difficulty ≥ `minDifficulty`". */
export interface Requirement {
  topicId: string;
  quantity: number;
  minDifficulty: Difficulty;
}

/** Take `amount` (> 0) tokens out of one bucket → one negative ledger row. */
export interface Debit {
  topicId: string;
  difficulty: Difficulty;
  amount: number;
}

export type DebitPlan = { ok: true; debits: Debit[] } | { ok: false; shortfalls: Shortfall[] };

/**
 * Requirements in allocation order: grouped by topic (first appearance),
 * most restrictive `minDifficulty` first. With nested "≥ min" ranges this
 * greedy never fails when an allocation exists, and together with ascending
 * debits it spends the cheapest tokens that satisfy everything.
 */
function allocationOrder<T extends Requirement>(reqs: readonly T[]): T[] {
  const topicOrder = new Map<string, number>();
  reqs.forEach((r) => {
    if (!topicOrder.has(r.topicId)) topicOrder.set(r.topicId, topicOrder.size);
  });
  return reqs
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        topicOrder.get(a.r.topicId)! - topicOrder.get(b.r.topicId)! ||
        difficultyRank(b.r.minDifficulty) - difficultyRank(a.r.minDifficulty) ||
        a.i - b.i
    )
    .map((x) => x.r);
}

/**
 * Plan the debits that cover every requirement: each one debits qualifying
 * buckets in ascending difficulty (Easy → Medium → Hard), skipping buckets
 * below its `minDifficulty`. Requirements with quantity ≤ 0 are ignored.
 * Debits are merged per bucket (one ledger row per bucket touched).
 */
export function planDebits(balances: Balances, requirements: readonly Requirement[]): DebitPlan {
  const available = new Map<string, number>(); // `${topic}\0${difficulty}` → tokens left
  const key = (t: string, d: Difficulty) => `${t}\u0000${d}`;
  const left = (t: string, d: Difficulty) => available.get(key(t, d)) ?? bucketBalance(balances, t, d);

  const debits = new Map<string, Debit>();
  const shortfalls: Shortfall[] = [];

  for (const req of allocationOrder(requirements.filter((r) => r.quantity > 0))) {
    let remaining = req.quantity;
    for (const d of difficultiesFrom(req.minDifficulty)) {
      if (remaining === 0) break;
      const take = Math.min(left(req.topicId, d), remaining);
      if (take <= 0) continue;
      available.set(key(req.topicId, d), left(req.topicId, d) - take);
      remaining -= take;
      const k = key(req.topicId, d);
      const prev = debits.get(k);
      debits.set(k, { topicId: req.topicId, difficulty: d, amount: (prev?.amount ?? 0) + take });
    }
    if (remaining > 0) {
      shortfalls.push({
        topicId: req.topicId,
        minDifficulty: req.minDifficulty,
        need: req.quantity,
        have: req.quantity - remaining,
      });
    }
  }

  if (shortfalls.length > 0) return { ok: false, shortfalls };
  return {
    ok: true,
    debits: [...debits.values()].sort(
      (a, b) =>
        a.topicId.localeCompare(b.topicId) || difficultyRank(a.difficulty) - difficultyRank(b.difficulty)
    ),
  };
}

// ─── Recipe progress, cheapest recipe (spec §3.4) ─────────────────────────

export interface RecipeItemInput {
  tokenTopicId: string;
  quantity: number;
  minDifficulty: Difficulty;
}

export interface RecipeInput {
  id: string;
  title: string;
  ord: number;
  items: readonly RecipeItemInput[];
}

export interface RecipeItemProgress {
  tokenTopicId: string;
  minDifficulty: Difficulty;
  need: number;
  /** Qualifying tokens available to this item (see recipeProgress). */
  have: number;
  /** max(0, need − have) */
  missing: number;
}

export interface RecipeProgress {
  recipeId: string;
  title: string;
  ord: number;
  /** Same order as the recipe's items. */
  items: RecipeItemProgress[];
  /** Σ per-item missing. 0 ⇔ the recipe can be spent right now. */
  missing: number;
  totalQuantity: number;
  ready: boolean;
}

/**
 * Per-item `have` / `missing` for one recipe: `missing = Σ max(0, quantity −
 * qualifying_balance)`. When several items draw on the same topic, each
 * item's qualifying balance is what is left after the items allocated
 * before it (the planDebits order) took theirs — so `missing = 0` exactly
 * when spending the recipe succeeds. With one item per topic this is the
 * plain qualifying balance.
 */
export function recipeProgress(recipe: RecipeInput, balances: Balances): RecipeProgress {
  const reqs = recipe.items.map((it, index) => ({
    index,
    topicId: it.tokenTopicId,
    quantity: it.quantity,
    minDifficulty: it.minDifficulty,
  }));
  const consumed: Balances = {};
  const availableTo = (topicId: string, min: Difficulty) =>
    difficultiesFrom(min).reduce(
      (s, d) => s + Math.max(0, bucketBalance(balances, topicId, d) - (consumed[topicId]?.[d] ?? 0)),
      0
    );

  const items: RecipeItemProgress[] = new Array(reqs.length);
  for (const req of allocationOrder(reqs)) {
    const have = availableTo(req.topicId, req.minDifficulty);
    // Consume what this item would take (ascending), so later items see the rest.
    let remaining = Math.min(have, Math.max(0, req.quantity));
    for (const d of difficultiesFrom(req.minDifficulty)) {
      if (remaining === 0) break;
      const free = bucketBalance(balances, req.topicId, d) - (consumed[req.topicId]?.[d] ?? 0);
      const take = Math.min(free, remaining);
      if (take <= 0) continue;
      const t = (consumed[req.topicId] ??= {});
      t[d] = (t[d] ?? 0) + take;
      remaining -= take;
    }
    items[req.index] = {
      tokenTopicId: req.topicId,
      minDifficulty: req.minDifficulty,
      need: req.quantity,
      have,
      missing: Math.max(0, req.quantity - have),
    };
  }

  const missing = items.reduce((s, i) => s + i.missing, 0);
  return {
    recipeId: recipe.id,
    title: recipe.title,
    ord: recipe.ord,
    items,
    missing,
    totalQuantity: recipe.items.reduce((s, i) => s + i.quantity, 0),
    ready: missing === 0,
  };
}

/** Cheapest-first: min `missing`, tie → min total quantity → `ord`. */
export function compareRecipeProgress(a: RecipeProgress, b: RecipeProgress): number {
  return a.missing - b.missing || a.totalQuantity - b.totalQuantity || a.ord - b.ord;
}

/** The cheapest recipe (null when there are none). */
export function cheapestRecipe(progress: readonly RecipeProgress[]): RecipeProgress | null {
  return [...progress].sort(compareRecipeProgress)[0] ?? null;
}

/** Recipe items as spend requirements. */
export function recipeRequirements(recipe: RecipeInput): Requirement[] {
  return recipe.items.map((i) => ({
    topicId: i.tokenTopicId,
    quantity: i.quantity,
    minDifficulty: i.minDifficulty,
  }));
}
