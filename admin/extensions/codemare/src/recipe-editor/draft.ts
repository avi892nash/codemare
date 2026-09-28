/**
 * Saved rows <-> editable drafts, and the single nested-write payload that
 * saves a topic's recipes: PATCH /items/topics/:id { recipes: { create,
 * update, delete } }. Directus runs a nested write in one transaction, so a
 * save applies completely or not at all. Pure; unit-tested.
 */
import type { Difficulty } from '../shared/rules';
import type { ItemDraft, RecipeDraft } from '../shared/recipe-checks';

export interface SavedItem {
  id: string;
  recipe_id: string;
  token_topic_id: string;
  quantity: number;
  min_difficulty: Difficulty;
}

export interface SavedRecipe {
  id: string;
  topic_id: string;
  title: string;
  ord: number;
  items: SavedItem[];
}

let seq = 0;
/** Client-side key for rows that do not have an id yet. */
export const newKey = (prefix: string) => `${prefix}-new-${++seq}`;

export function toDraft(recipes: readonly SavedRecipe[]): RecipeDraft[] {
  return [...recipes]
    .sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
    .map((r) => ({
      key: r.id,
      id: r.id,
      title: r.title,
      items: [...r.items]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((it) => ({
          key: it.id,
          id: it.id,
          tokenTopicId: it.token_topic_id,
          quantity: it.quantity,
          minDifficulty: it.min_difficulty,
        })),
    }));
}

export function emptyItem(): ItemDraft {
  return { key: newKey('item'), tokenTopicId: null, quantity: 1, minDifficulty: 'Easy' };
}

export function emptyRecipe(title = ''): RecipeDraft {
  return { key: newKey('recipe'), title, items: [emptyItem()] };
}

const itemFields = (it: ItemDraft) => ({
  token_topic_id: it.tokenTopicId,
  quantity: it.quantity,
  min_difficulty: it.minDifficulty,
});

type Json = Record<string, unknown>;

export interface SavePayload {
  recipes: { create: Json[]; update: Json[]; delete: string[] };
}

/**
 * The nested write turning `saved` into `draft` (order = ord 0..n-1). Only
 * changed rows are sent, so an untouched recipe produces no write or revision.
 * Returns null when nothing changed.
 */
export function buildSavePayload(saved: readonly SavedRecipe[], draft: readonly RecipeDraft[]): SavePayload | null {
  const savedById = new Map(saved.map((r) => [r.id, r]));
  const create: Json[] = [];
  const update: Json[] = [];

  draft.forEach((r, ord) => {
    const title = r.title.trim();
    const before = r.id ? savedById.get(r.id) : undefined;
    if (!before) {
      create.push({ title, ord, items: r.items.map(itemFields) });
      return;
    }
    const patch: Json = { id: before.id };
    if (before.title !== title) patch.title = title;
    if (before.ord !== ord) patch.ord = ord;

    const itemsBefore = new Map(before.items.map((it) => [it.id, it]));
    const createItems = r.items.filter((it) => !it.id || !itemsBefore.has(it.id)).map(itemFields);
    const updateItems: Json[] = [];
    for (const it of r.items) {
      const old = it.id ? itemsBefore.get(it.id) : undefined;
      if (!old) continue;
      const changes: Json = {};
      if (old.token_topic_id !== it.tokenTopicId) changes.token_topic_id = it.tokenTopicId;
      if (old.quantity !== it.quantity) changes.quantity = it.quantity;
      if (old.min_difficulty !== it.minDifficulty) changes.min_difficulty = it.minDifficulty;
      if (Object.keys(changes).length > 0) updateItems.push({ id: old.id, ...changes });
    }
    const kept = new Set(r.items.map((it) => it.id).filter(Boolean));
    const deleteItems = before.items.filter((it) => !kept.has(it.id)).map((it) => it.id);
    if (createItems.length || updateItems.length || deleteItems.length) {
      patch.items = { create: createItems, update: updateItems, delete: deleteItems };
    }
    if (Object.keys(patch).length > 1) update.push(patch);
  });

  const keptRecipes = new Set(draft.map((r) => r.id).filter(Boolean));
  const del = saved.filter((r) => !keptRecipes.has(r.id)).map((r) => r.id);

  if (create.length === 0 && update.length === 0 && del.length === 0) return null;
  return { recipes: { create, update, delete: del } };
}

/** Structural equality of drafts (ignores client keys). */
export function sameDraft(a: readonly RecipeDraft[], b: readonly RecipeDraft[]): boolean {
  const norm = (d: readonly RecipeDraft[]) =>
    JSON.stringify(
      d.map((r) => ({
        id: r.id ?? null,
        title: r.title.trim(),
        items: r.items.map((it) => ({
          id: it.id ?? null,
          t: it.tokenTopicId,
          q: it.quantity,
          m: it.minDifficulty,
        })),
      }))
    );
  return norm(a) === norm(b);
}
