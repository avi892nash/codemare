/**
 * Reads and writes for the recipe editor, all through the Directus API (so
 * permissions, hooks, activity and revisions apply as for any other edit).
 */
import type { Balances } from '../shared/rules';
import type { TopicInfo } from '../shared/recipe-checks';
import type { SavedItem, SavedRecipe, SavePayload } from './draft';

/** The axios instance from useApi(). */
export interface Api {
  get<T = unknown>(url: string, config?: { params?: Record<string, unknown> }): Promise<{ data: T }>;
  patch<T = unknown>(url: string, body: unknown, config?: { params?: Record<string, unknown> }): Promise<{ data: T }>;
}

export interface Tier {
  id: string;
  ord: number;
  title: string;
}

export interface Topic extends TopicInfo {
  ord: number;
  tierId: string;
}

export interface SupplyInfo {
  supply: Balances;
  counts: Record<string, { questions: number }>;
}

export interface EditorData {
  tiers: Tier[];
  topics: Topic[];
  recipes: SavedRecipe[];
  supply: SupplyInfo | null;
  /** False when topics.recipes / unlock_recipes.items are not configured (content model not applied). */
  canNestWrites: boolean;
}

interface Envelope<T> {
  data: T;
}

export async function loadEditorData(api: Api): Promise<EditorData> {
  const [tiers, topics, recipes, items, supply, rel1, rel2] = await Promise.all([
    api.get<Envelope<Tier[]>>('/items/tiers', { params: { fields: 'id,ord,title', sort: 'ord', limit: -1 } }),
    api.get<Envelope<{ id: string; slug: string; title: string; ord: number; tier_id: string }[]>>('/items/topics', {
      params: { fields: 'id,slug,title,ord,tier_id', limit: -1 },
    }),
    api.get<Envelope<Omit<SavedRecipe, 'items'>[]>>('/items/unlock_recipes', {
      params: { fields: 'id,topic_id,title,ord', sort: 'ord', limit: -1 },
    }),
    api.get<Envelope<SavedItem[]>>('/items/recipe_items', {
      params: { fields: 'id,recipe_id,token_topic_id,quantity,min_difficulty', limit: -1 },
    }),
    api.get<Envelope<SupplyInfo>>('/codemare/recipe-supply').catch(() => null),
    api.get<Envelope<{ meta: { one_field: string | null } | null }>>('/relations/unlock_recipes/topic_id').catch(() => null),
    api.get<Envelope<{ meta: { one_field: string | null } | null }>>('/relations/recipe_items/recipe_id').catch(() => null),
  ]);

  const tierById = new Map(tiers.data.data.map((t) => [t.id, t]));
  const itemsByRecipe = new Map<string, SavedItem[]>();
  for (const it of items.data.data) {
    const list = itemsByRecipe.get(it.recipe_id) ?? [];
    list.push(it);
    itemsByRecipe.set(it.recipe_id, list);
  }

  return {
    tiers: tiers.data.data,
    topics: topics.data.data
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        title: t.title,
        ord: t.ord,
        tierId: t.tier_id,
        tierOrd: tierById.get(t.tier_id)?.ord ?? 0,
      }))
      .sort((a, b) => a.tierOrd - b.tierOrd || a.ord - b.ord || a.title.localeCompare(b.title)),
    recipes: recipes.data.data.map((r) => ({ ...r, items: itemsByRecipe.get(r.id) ?? [] })),
    supply: supply?.data.data ?? null,
    canNestWrites:
      rel1?.data.data.meta?.one_field === 'recipes' && rel2?.data.data.meta?.one_field === 'items',
  };
}

/** One nested write: every change to this topic's recipes, in one transaction. */
export async function saveTopicRecipes(api: Api, topicId: string, payload: SavePayload): Promise<void> {
  await api.patch(`/items/topics/${encodeURIComponent(topicId)}`, payload, { params: { fields: 'id' } });
}

/** A readable message out of an axios/Directus error. */
export function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: { errors?: { message?: string }[] } }; message?: string };
  return e.response?.data?.errors?.map((x) => x.message).filter(Boolean).join('; ') || e.message || String(error);
}
