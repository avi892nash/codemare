/**
 * The Directus content model for content.* — collections, fields, relations,
 * folders and the Content Editor role — as data. apply.ts writes it through
 * the Directus API. Everything here is META ONLY (interfaces, displays,
 * notes, validation, O2M alias fields); Prisma migrations own every table and
 * column, and the directus database role could not change them anyway.
 *
 * When a migration adds a content column, add it here too: the apply script
 * reports columns it finds in Directus that this model does not describe.
 */
import schemaText from '../../web/prisma/schema.prisma';
import { CONTENT_ICON_NAMES } from '../../web/lib/types';
import { CONTENT_COLLECTIONS } from '../extensions/codemare/src/shared/content-tables';
import { parsePrismaEnums } from './prisma-enums';

type Meta = Record<string, unknown>;

export interface FieldSpec {
  field: string;
  meta: Meta;
  /** An O2M alias field (no column); created if missing. */
  alias?: boolean;
}

export interface CollectionSpec {
  collection: string;
  meta: Meta;
  fields: FieldSpec[];
}

export interface FolderSpec {
  collection: string;
  meta: Meta;
}

export interface RelationSpec {
  /** The many side (the table holding the foreign key). */
  collection: string;
  field: string;
  meta: Meta;
}

const ENUMS = parsePrismaEnums(schemaText);

function enumValues(name: string): string[] {
  const values = ENUMS[name];
  if (!values?.length) throw new Error(`enum ${name} not found in web/prisma/schema.prisma`);
  return values;
}

const choices = (values: readonly string[]) => values.map((v) => ({ text: v, value: v }));

// ── field helpers ───────────────────────────────────────────────────────────

const id = (): FieldSpec => ({
  field: 'id',
  meta: {
    interface: 'input',
    readonly: true,
    hidden: true,
    width: 'half',
    note: 'cuid — set automatically on create.',
  },
});

const text = (field: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: { interface: 'input', width: 'half', required: true, ...extra },
});

const slug = (field = 'slug', note = 'URL key; lowercase, unique.'): FieldSpec => ({
  field,
  meta: {
    interface: 'input',
    options: { slug: true, trim: true, font: 'monospace' },
    width: 'half',
    required: true,
    note,
  },
});

const textarea = (field: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: { interface: 'input-multiline', width: 'full', required: true, ...extra },
});

const markdown = (field: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: { interface: 'input-rich-text-md', width: 'full', required: true, ...extra },
});

const json = (field: string, note: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: {
    interface: 'input-code',
    options: { lineNumber: true, lineWrapping: true },
    width: 'full',
    required: true,
    note,
    ...extra,
  },
});

const integer = (field: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: { interface: 'input', width: 'half', required: true, options: { min: 0, step: 1 }, ...extra },
});

const decimal = (field: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: { interface: 'input', width: 'half', required: true, options: { min: 0, step: 0.5 }, ...extra },
});

const order = (field = 'ord', note = 'Sort order (ascending).'): FieldSpec => integer(field, { note });

const enumSelect = (field: string, enumName: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: {
    interface: 'select-dropdown',
    options: { choices: choices(enumValues(enumName)) },
    display: 'labels',
    display_options: { choices: choices(enumValues(enumName)), showAsDot: false },
    width: 'half',
    required: true,
    ...extra,
  },
});

const enumMulti = (field: string, enumName: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: {
    interface: 'select-multiple-checkbox',
    options: { choices: choices(enumValues(enumName)) },
    display: 'labels',
    display_options: { choices: choices(enumValues(enumName)) },
    width: 'full',
    ...extra,
  },
});

const tags = (field: string, note: string): FieldSpec => ({
  field,
  meta: {
    interface: 'tags',
    options: { alphabetize: false, allowCustom: true },
    display: 'labels',
    width: 'full',
    note,
  },
});

const icon = (field = 'icon'): FieldSpec => ({
  field,
  meta: {
    interface: 'select-dropdown',
    options: { choices: choices(CONTENT_ICON_NAMES) },
    width: 'half',
    required: true,
    note: 'An icon name from components/ui/Icon.tsx (spec §8).',
  },
});

const m2o = (field: string, template: string, extra: Meta = {}): FieldSpec => ({
  field,
  meta: {
    interface: 'select-dropdown-m2o',
    options: { template },
    display: 'related-values',
    display_options: { template },
    width: 'half',
    required: true,
    ...extra,
  },
});

const o2m = (field: string, template: string, extra: Meta = {}): FieldSpec => ({
  field,
  alias: true,
  meta: {
    special: ['o2m'],
    interface: 'list-o2m',
    options: { template, enableSelect: false },
    display: 'related-values',
    display_options: { template },
    width: 'full',
    ...extra,
  },
});

const timestamp = (field: string, note: string): FieldSpec => ({
  field,
  meta: { interface: 'datetime', display: 'datetime', display_options: { relative: true }, readonly: true, width: 'half', note },
});

// ── folders (alias collections, no table) ────────────────────────────────────

const folder = (collection: string, name: string, iconName: string, sort: number): FolderSpec => ({
  collection,
  meta: { icon: iconName, sort, collapse: 'open', translations: [{ language: 'en-US', translation: name }] },
});

export const FOLDERS: FolderSpec[] = [
  folder('cm_learning_loop', 'Learning loop', 'account_tree', 1),
  folder('cm_questions', 'Questions', 'quiz', 2),
  folder('cm_learn', 'Learn', 'school', 3),
  folder('cm_library', 'Library (hidden)', 'local_library', 4),
];

const collection = (
  name: string,
  group: string | null,
  sort: number,
  meta: Meta,
  fields: FieldSpec[]
): CollectionSpec => ({
  collection: name,
  meta: { group, sort, collapse: 'open', archive_field: null, accountability: 'all', ...meta },
  fields: fields.map((f, i) => ({ ...f, meta: { ...f.meta, sort: i + 1 } })),
});

// ── collections ─────────────────────────────────────────────────────────────

export const COLLECTIONS: CollectionSpec[] = [
  collection(
    'tiers',
    'cm_learning_loop',
    1,
    { icon: 'stairs', display_template: 'Tier {{ord}} · {{title}}', note: 'Tier 0 is free; higher tiers open through their gate.' },
    [
      id(),
      integer('ord', { note: 'Unique. 0 = the free tier (always open).' }),
      slug(),
      text('title'),
      textarea('summary'),
      o2m('topics', '{{title}}', { note: 'Topics in this tier.', readonly: true }),
    ]
  ),
  collection(
    'topics',
    'cm_learning_loop',
    2,
    { icon: 'category', display_template: '{{title}}', note: 'Recipes are edited in the Recipe editor module.' },
    [
      id(),
      m2o('tier_id', 'Tier {{ord}} · {{title}}', { note: 'The tier this topic belongs to.' }),
      slug(),
      text('title'),
      textarea('summary'),
      icon(),
      order('ord', 'Order within the tier.'),
      o2m('recipes', '{{ord}}. {{title}}', {
        note: 'Any one recipe unlocks the topic. Edit them in the Recipe editor module (validation + cost preview).',
      }),
    ]
  ),
  collection(
    'unlock_recipes',
    'cm_learning_loop',
    3,
    {
      icon: 'lock_open',
      display_template: '{{topic_id.title}} · {{title}}',
      note: 'Prefer the Recipe editor module: it validates and previews costs.',
    },
    [
      id(),
      m2o('topic_id', '{{title}}', { note: 'The topic this recipe unlocks.' }),
      text('title'),
      order('ord', 'Order among the topic’s recipes (ties in cost go to the lower ord).'),
      o2m('items', '{{quantity}} × {{token_topic_id.title}} ({{min_difficulty}}+)', {
        note: 'Tokens spent: quantity of a topic’s tokens earned at min difficulty or harder.',
      }),
    ]
  ),
  collection(
    'recipe_items',
    'cm_learning_loop',
    4,
    { icon: 'toll', display_template: '{{quantity}} × {{token_topic_id.title}} ({{min_difficulty}}+)', hidden: true },
    [
      id(),
      m2o('recipe_id', '{{topic_id.title}} · {{title}}'),
      m2o('token_topic_id', '{{title}}', { note: 'Whose tokens are spent. Never the recipe’s own topic.' }),
      integer('quantity', {
        options: { min: 1, step: 1 },
        note: 'Whole number ≥ 1.',
        validation: { _and: [{ quantity: { _gte: 1 } }] },
        validation_message: 'Quantity must be at least 1.',
      }),
      enumSelect('min_difficulty', 'Difficulty', { note: 'Tokens must come from this difficulty or harder.' }),
    ]
  ),
  collection(
    'components',
    'cm_learning_loop',
    5,
    {
      icon: 'extension',
      display_template: '{{title}}',
      note: 'Library functions learners build. Dependencies (component_deps) are edited in the seed files.',
    },
    [
      id(),
      m2o('topic_id', '{{title}}'),
      slug(),
      text('title'),
      markdown('summary_md'),
      text('function_name', { options: { font: 'monospace' } }),
      json('signature', 'Signature: { params: [{ name, type }], returns } (spec §2.1).'),
      enumMulti('languages', 'Language', { note: 'Languages this component can be built in (Java is not supported for builds).' }),
      order(),
      o2m('build_steps', '{{ord}}. {{title}} ({{kind}})'),
    ]
  ),
  collection(
    'build_steps',
    'cm_learning_loop',
    6,
    { icon: 'format_list_numbered', display_template: '{{component_id.title}} · {{ord}}. {{title}}' },
    [
      id(),
      m2o('component_id', '{{title}}'),
      order(),
      enumSelect('kind', 'BuildStepKind'),
      text('title'),
      markdown('prompt_md'),
      enumSelect('difficulty', 'Difficulty', { note: 'Sets the token award of a build step.' }),
      json('payload', 'predict: { language, code, question, choices?, answer, explanation_md } · build: { starter_code, tests, compare_mode? } (spec §2.1).'),
      o2m('hints', '{{level}} ({{cost_kind}} {{cost_amount}})'),
    ]
  ),
  collection(
    'gates',
    'cm_learning_loop',
    7,
    {
      icon: 'door_front',
      display_template: '{{title}}',
      note: 'One gate per tier above 0. Gate questions (gate_questions) are edited in the seed files.',
    },
    [
      id(),
      m2o('tier_id', 'Tier {{ord}} · {{title}}', { note: 'The tier this gate opens (one gate per tier).' }),
      text('title'),
      textarea('summary'),
      integer('pass_threshold', { note: 'Gate questions to pass.' }),
      integer('cooldown_hours', {
        options: { min: 12, max: 24, step: 1 },
        note: '12–24 hours after a failed attempt.',
        validation: { _and: [{ cooldown_hours: { _gte: 12 } }, { cooldown_hours: { _lte: 24 } }] },
        validation_message: 'Cooldown must be between 12 and 24 hours.',
      }),
      integer('time_limit_minutes'),
    ]
  ),
  collection(
    'badges',
    null,
    5,
    { icon: 'military_tech', display_template: '{{name}}' },
    [
      id(),
      slug(),
      text('name'),
      textarea('description'),
      icon(),
      enumSelect('rarity', 'BadgeRarity'),
      json('criteria', 'e.g. { "kind": "solves", "n": 10 } — kinds in spec §2.1.'),
      order(),
    ]
  ),
  collection(
    'questions',
    'cm_questions',
    1,
    {
      icon: 'quiz',
      display_template: '{{title}}',
      note: 'Question topics and weights (question_topics) are edited in the seed files.',
    },
    [
      id(),
      slug(),
      text('title'),
      enumSelect('difficulty', 'Difficulty'),
      enumSelect('status', 'PublishStatus', { note: 'Only published questions are listed to learners.' }),
      markdown('statement_md'),
      json('examples', 'Example[]: [{ input, output, explanation? }].'),
      json('constraints', 'string[] shown under the statement.'),
      text('function_name', { options: { font: 'monospace' } }),
      json('signature', 'Signature (spec §2.1); required for C++, Java and Go.'),
      enumSelect('compare_mode', 'CompareMode'),
      json('starter_code', '{ language: code } — every stub must compile as-is.'),
      json('tests', 'TestDef[]: [{ input: [...], expected, hidden, explain_on_fail? }].'),
      json('reference_solutions', '{ language: code } — never sent to learners.'),
      tags('tags', 'Catalog filters.'),
      tags('companies', 'Catalog filters.'),
      markdown('editorial_md', { required: false }),
      integer('time_limit_ms', { note: 'Per test.' }),
      integer('memory_limit_mb'),
      {
        field: 'author_id',
        meta: {
          interface: 'input',
          readonly: true,
          hidden: true,
          width: 'half',
          note: 'Set by the web authoring flow. The author lives in app.users, which Directus cannot read.',
        },
      },
      timestamp('created_at', 'Set by the database.'),
      timestamp('updated_at', 'Bumped on every save (web and Directus).'),
      o2m('hints', '{{level}} ({{cost_kind}} {{cost_amount}})', { note: 'Hint ladder: nudge → concept → pseudo → line → solution.' }),
    ]
  ),
  collection(
    'hints',
    'cm_questions',
    2,
    {
      icon: 'lightbulb',
      display_template: '{{level}} · {{question_id.title}}{{build_step_id.title}}',
      note: 'Set exactly one of question / build step.',
    },
    [
      id(),
      m2o('question_id', '{{title}}', { required: false }),
      m2o('build_step_id', '{{title}}', { required: false }),
      enumSelect('level', 'HintLevel'),
      markdown('body_md'),
      enumSelect('cost_kind', 'HintCostKind', { note: 'score: % off the future award · token: tokens spent.' }),
      integer('cost_amount', { note: '≥ 0.' }),
    ]
  ),
  collection(
    'tracks',
    'cm_learn',
    1,
    { icon: 'route', display_template: '{{title}}' },
    [
      id(),
      slug(),
      text('title'),
      textarea('summary'),
      enumSelect('level', 'TrackLevel'),
      m2o('tier_id', 'Tier {{ord}} · {{title}}', { required: false }),
      decimal('est_hours'),
      order(),
      o2m('modules', '{{ord}}. {{title}}'),
    ]
  ),
  collection(
    'learn_modules',
    'cm_learn',
    2,
    { icon: 'view_module', display_template: '{{track_id.title}} · {{title}}' },
    [
      id(),
      m2o('track_id', '{{title}}'),
      slug(undefined, 'Unique within the track.'),
      text('title'),
      textarea('summary'),
      order(),
      o2m('lessons', '{{ord}}. {{title}}'),
      o2m('checkpoint_questions', '{{ord}}. {{kind}}'),
    ]
  ),
  collection(
    'lessons',
    'cm_learn',
    3,
    { icon: 'menu_book', display_template: '{{title}}' },
    [
      id(),
      m2o('module_id', '{{title}}'),
      slug(undefined, 'Unique within the track (routes are /learn/[track]/[lesson]).'),
      text('title'),
      order(),
      markdown('body_md', { note: 'Lesson markdown with run / callout / viz / question blocks (spec §6.2).' }),
      integer('est_minutes'),
      m2o('topic_id', '{{title}}', { required: false }),
      tags('related_question_slugs', 'Question slugs shown as related practice.'),
    ]
  ),
  collection(
    'checkpoint_questions',
    'cm_learn',
    4,
    { icon: 'fact_check', display_template: '{{ord}}. {{kind}}' },
    [
      id(),
      m2o('module_id', '{{title}}'),
      order(),
      enumSelect('kind', 'CheckpointKind'),
      markdown('prompt_md'),
      json('choices', 'string[] for mcq; empty for short answers.', { required: false }),
      json('answer', 'mcq: choice index · short: string or string[] of accepted answers.'),
      markdown('explanation_md'),
    ]
  ),
  collection(
    'library_areas',
    'cm_library',
    1,
    { icon: 'local_library', display_template: '{{title}}' },
    [id(), slug(), text('title'), textarea('summary'), icon(), order(), o2m('chapters', '{{ord}}. {{title}}')]
  ),
  collection(
    'library_chapters',
    'cm_library',
    2,
    { icon: 'bookmarks', display_template: '{{area_id.title}} · {{title}}' },
    [id(), m2o('area_id', '{{title}}'), slug(undefined, 'Unique within the area.'), text('title'), order(), o2m('articles', '{{ord}}. {{title}}')]
  ),
  collection(
    'library_articles',
    'cm_library',
    3,
    { icon: 'article', display_template: '{{title}}', note: 'Write original content; do not copy cp-algorithms.com.' },
    [
      id(),
      m2o('chapter_id', '{{title}}'),
      slug(),
      text('title'),
      textarea('summary'),
      enumSelect('difficulty', 'Difficulty'),
      enumSelect('status', 'PublishStatus'),
      integer('reading_minutes'),
      markdown('idea_md'),
      {
        field: 'formula',
        meta: { interface: 'input-multiline', options: { font: 'monospace' }, width: 'full', note: 'TeX, optional.' },
      },
      {
        field: 'code_cpp',
        meta: { interface: 'input-code', options: { language: 'clike', lineNumber: true }, width: 'full', required: true },
      },
      text('viz_id', { required: false, note: 'A registered visualization id, optional.' }),
      markdown('applications_md'),
      markdown('pitfall_md'),
      tags('practice_question_slugs', 'Question slugs to practise with.'),
      order(),
    ]
  ),
];

// Every Directus-manageable content table is described exactly once.
{
  const described = COLLECTIONS.map((c) => c.collection).sort();
  const expected = [...CONTENT_COLLECTIONS].sort();
  if (JSON.stringify(described) !== JSON.stringify(expected)) {
    throw new Error(`content model out of sync: describes ${described.join(',')} but expects ${expected.join(',')}`);
  }
}

// ── relations (meta for the foreign keys Prisma created) ─────────────────────

const o2mRelation = (collection: string, field: string, oneField: string, sortField: string | null = 'ord'): RelationSpec => ({
  collection,
  field,
  // Removing a child from the parent's list deletes it (the FK is NOT NULL).
  meta: { one_field: oneField, sort_field: sortField, one_deselect_action: 'delete' },
});

export const RELATIONS: RelationSpec[] = [
  { collection: 'topics', field: 'tier_id', meta: { one_field: 'topics', sort_field: null, one_deselect_action: 'nullify' } },
  o2mRelation('unlock_recipes', 'topic_id', 'recipes'),
  o2mRelation('recipe_items', 'recipe_id', 'items', null),
  o2mRelation('build_steps', 'component_id', 'build_steps'),
  o2mRelation('hints', 'question_id', 'hints', null),
  o2mRelation('hints', 'build_step_id', 'hints', null),
  o2mRelation('learn_modules', 'track_id', 'modules'),
  o2mRelation('lessons', 'module_id', 'lessons'),
  o2mRelation('checkpoint_questions', 'module_id', 'checkpoint_questions'),
  o2mRelation('library_chapters', 'area_id', 'chapters'),
  o2mRelation('library_articles', 'chapter_id', 'articles'),
];

// ── access ──────────────────────────────────────────────────────────────────

export const CONTENT_EDITOR = {
  role: { name: 'Content Editor', icon: 'edit_note', description: 'Staff who edit content.* (questions, the learning loop, learn, library).' },
  policy: {
    name: 'Content Editor',
    icon: 'edit_note',
    description: 'Create, read, update and delete every content collection; no admin access.',
    app_access: true,
    admin_access: false,
    enforce_tfa: false,
  },
  collections: [...CONTENT_COLLECTIONS],
  actions: ['create', 'read', 'update', 'delete'] as const,
};

export const PROJECT_SETTINGS = {
  project_name: 'Codemare',
  project_descriptor: 'Content admin',
  project_color: '#587CF1',
};

/** Where the recipe editor sits in the module bar (right after Content). */
export const MODULE = { id: 'recipe-editor', after: 'content' };

/**
 * Directus 12's default module bar (used when the setting is still null),
 * so enabling our module keeps every built-in module where it was.
 */
export const DEFAULT_MODULE_BAR = [
  { type: 'module', id: 'content', enabled: true },
  { type: 'module', id: 'visual', enabled: false },
  { type: 'module', id: 'users', enabled: true },
  { type: 'module', id: 'files', enabled: true },
  { type: 'module', id: 'insights', enabled: true },
  { type: 'module', id: 'flows', enabled: true },
  { type: 'module', id: 'deployments', enabled: false },
  { type: 'link', id: 'docs', enabled: true, name: '$t:documentation', icon: 'help', url: 'https://directus.com/docs' },
  { type: 'module', id: 'settings', enabled: true, locked: true },
];
