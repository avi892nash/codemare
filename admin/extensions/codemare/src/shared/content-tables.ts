/**
 * Facts about the content.* tables that Directus cannot learn from Postgres
 * on its own. Shared by the hooks (API side), the recipe editor (app side)
 * and the content-model apply script.
 */

/**
 * Tables Directus manages: every content table. Directus only manages tables
 * with a single-column primary key, which is why the join tables
 * (question_topics, gate_questions, component_deps) carry a surrogate `id`
 * with their natural pair kept unique (migration 20260929090000).
 */
export const CONTENT_COLLECTIONS = [
  'tiers',
  'topics',
  'unlock_recipes',
  'recipe_items',
  'components',
  'build_steps',
  'component_deps',
  'questions',
  'question_topics',
  'hints',
  'gates',
  'gate_questions',
  'badges',
  'tracks',
  'learn_modules',
  'lessons',
  'checkpoint_questions',
  'library_areas',
  'library_chapters',
  'library_articles',
] as const;
export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];

export function isContentCollection(name: string): name is ContentCollection {
  return (CONTENT_COLLECTIONS as readonly string[]).includes(name);
}

/**
 * Postgres array columns. Directus types them `unknown` and would JSON-encode
 * an array on write ('["a"]', which Postgres rejects); the hooks turn arrays
 * into array literals ('{"a"}') instead.
 */
export const ARRAY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  questions: ['tags', 'companies'],
  components: ['languages'],
  lessons: ['related_question_slugs'],
  library_articles: ['practice_question_slugs'],
};

/**
 * Arrays of an enum type (content."Language"[]). node-postgres has no parser
 * for their dynamic type oid and returns the raw '{a,b}' text, so the read
 * hook parses them back into arrays.
 */
export const ENUM_ARRAY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  components: ['languages'],
};

/**
 * Timestamps Prisma maintains client-side (@updatedAt has no database
 * trigger), so edits made through Directus must bump them too.
 */
export const UPDATED_AT_COLUMNS: Readonly<Record<string, string>> = {
  questions: 'updated_at',
};
