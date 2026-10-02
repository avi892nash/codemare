/**
 * Seed input contract — the exact shape of every file under
 * `web/prisma/seed/data/` (spec §6.1). Content authors write against these
 * schemas; `npm run seed -w web` validates every file with them (plus the
 * cross-file checks in validate.ts) before writing anything.
 *
 * Layout:
 *   data/loop.json               LoopFile       tiers, topics, recipes, gates
 *   data/questions/<slug>.json   QuestionFile   one question per file; file name = slug
 *   data/badges.json             BadgesFile     a top-level array of badges (optional)
 *   data/learn/<track>.json      TrackFile      one track per file; file name = track slug (optional dir)
 *   data/library/<area>.json     AreaFile       one area per file; file name = area slug (optional dir)
 *
 * Conventions:
 *   · slugs are kebab-case (`two-sum`), unique per kind; references use slugs
 *   · keys are snake_case, exactly as below — unknown keys are rejected
 *   · `ord` is implicit from array order unless a field says otherwise
 *   · markdown fields end in `_md` (lesson markdown: spec §6.2)
 *   · icons must be one of CONTENT_ICON_NAMES (lib/types.ts, spec §8)
 */
import { z } from 'zod';
import { CONTENT_ICON_NAMES, DEFAULT_HINT_SCORE_COST, HINT_LEVELS } from '../../lib/types';
import {
  badgeCriteriaSchema,
  compareModeSchema,
  difficultySchema,
  exampleSchema,
  identifierSchema,
  signatureSchema,
  testDefSchema,
} from '../../lib/server/schemas';

export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slugs are kebab-case: lowercase letters, digits and single dashes');
export const iconSchema = z.enum(CONTENT_ICON_NAMES);
const text = z.string().min(1);
const positiveInt = z.number().int().positive();

// ─── Hints ───────────────────────────────────────────────────────────────

/**
 * One rung of a hint ladder. Levels must be unique and gapless from `nudge`
 * (nudge → concept → pseudo → line → solution). `cost_kind` defaults to
 * `score`; a score cost defaults to the spec's per-level default
 * (nudge 0, concept 10, pseudo 25, line 40, solution 100) and is a % (0–100);
 * a token cost needs an explicit `cost_amount` (tokens of the question's
 * highest-weight topic).
 */
export const hintInputSchema = z
  .object({
    level: z.enum(HINT_LEVELS),
    body_md: text,
    cost_kind: z.enum(['score', 'token']).default('score'),
    cost_amount: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((h, ctx) => {
    if (h.cost_kind === 'token' && h.cost_amount === undefined) {
      ctx.addIssue({ code: 'custom', message: 'a token-cost hint needs cost_amount', path: ['cost_amount'] });
    }
    if (h.cost_kind === 'score' && (h.cost_amount ?? 0) > 100) {
      ctx.addIssue({ code: 'custom', message: 'a score cost is a percentage (0–100)', path: ['cost_amount'] });
    }
  })
  .transform((h) => ({
    ...h,
    cost_amount: h.cost_amount ?? (h.cost_kind === 'score' ? DEFAULT_HINT_SCORE_COST[h.level] : 0),
  }));
export type HintInput = z.input<typeof hintInputSchema>;
export type Hint = z.output<typeof hintInputSchema>;

// ─── loop.json ───────────────────────────────────────────────────────────

/** `ord` 0 is the free tier (exactly one). Each tier > 0 needs a gate. */
export const tierInputSchema = z
  .object({
    ord: z.number().int().nonnegative(),
    slug: slugSchema,
    title: text,
    summary: z.string(),
  })
  .strict();

/** `ord` defaults to the topic's position among its tier's topics in this file. */
export const topicInputSchema = z
  .object({
    slug: slugSchema,
    /** Tier slug. */
    tier: slugSchema,
    title: text,
    summary: z.string(),
    icon: iconSchema,
    ord: z.number().int().nonnegative().optional(),
  })
  .strict();

export const recipeItemInputSchema = z
  .object({
    /** Topic slug whose tokens are spent. */
    topic: slugSchema,
    quantity: positiveInt,
    min_difficulty: difficultySchema.default('Easy'),
  })
  .strict();

/**
 * One way to unlock `topic` (any one recipe suffices). A recipe's `ord` is its
 * position among the recipes of the same topic in this file. Every topic in a
 * tier > 0 needs at least one, and it must be satisfiable with tokens of
 * topics that can be unlocked before it.
 */
export const recipeInputSchema = z
  .object({
    /** Topic slug this recipe unlocks. */
    topic: slugSchema,
    title: text,
    items: z.array(recipeItemInputSchema).min(1),
  })
  .strict();

/** The gate that opens `tier` (tier ord > 0). */
export const gateInputSchema = z
  .object({
    /** Tier slug this gate opens. */
    tier: slugSchema,
    title: text,
    summary: z.string(),
    /** Accepted gate questions needed to pass (≤ questions.length). */
    pass_threshold: positiveInt,
    cooldown_hours: z.number().int().min(12).max(24),
    time_limit_minutes: positiveInt.default(60),
    /** Question slugs, in display order. */
    questions: z.array(slugSchema).min(1),
  })
  .strict();

export const loopFileSchema = z
  .object({
    tiers: z.array(tierInputSchema).min(1),
    topics: z.array(topicInputSchema).min(1),
    recipes: z.array(recipeInputSchema).default([]),
    gates: z.array(gateInputSchema).default([]),
  })
  .strict();
export type LoopFileInput = z.input<typeof loopFileSchema>;
export type LoopFile = z.output<typeof loopFileSchema>;

// ─── questions/<slug>.json ───────────────────────────────────────────────

const code = z.string().min(1);

/**
 * One question. Starter code for all six languages, each compiling verbatim
 * (non-void stubs return a zero value; Go stubs have no `package` clause and
 * no imports; TypeScript stubs are typed function declarations). Reference
 * solutions are never sent to learners.
 */
export const questionFileSchema = z
  .object({
    slug: slugSchema,
    title: text,
    difficulty: difficultySchema,
    statement_md: text,
    examples: z.array(exampleSchema),
    constraints: z.array(z.string()),
    function_name: identifierSchema,
    signature: signatureSchema,
    compare_mode: compareModeSchema.default('ordered'),
    starter_code: z
      .object({ python: code, javascript: code, typescript: code, cpp: code, java: code, go: code })
      .strict(),
    /** Each test's `input` is the argument list (length = signature params). */
    tests: z.array(testDefSchema).min(1),
    reference_solutions: z
      .object({
        python: code,
        javascript: code,
        typescript: code.optional(),
        cpp: code.optional(),
        java: code.optional(),
        go: code.optional(),
      })
      .strict(),
    /** Topics paid on first accept, split by weight (composite questions list several). */
    topics: z
      .array(z.object({ slug: slugSchema, weight: z.number().positive().default(1) }).strict())
      .min(1),
    tags: z.array(z.string().min(1)).default([]),
    companies: z.array(z.string().min(1)).default([]),
    editorial_md: z.string().nullable().default(null),
    hints: z.array(hintInputSchema).default([]),
    status: z.enum(['draft', 'published']).default('published'),
    time_limit_ms: positiveInt.default(2000),
    memory_limit_mb: positiveInt.default(256),
  })
  .strict();
export type QuestionFileInput = z.input<typeof questionFileSchema>;
export type QuestionFile = z.output<typeof questionFileSchema>;

// ─── badges.json ─────────────────────────────────────────────────────────

/** One badge. Criteria semantics: lib/server/rules/badges.ts. */
export const badgeInputSchema = z
  .object({
    slug: slugSchema,
    name: text,
    description: z.string(),
    icon: iconSchema,
    rarity: z.enum(['common', 'rare', 'epic', 'legendary']),
    criteria: badgeCriteriaSchema,
    /** Gallery order; defaults to the badge's position in the file. */
    ord: z.number().int().nonnegative().optional(),
  })
  .strict();

/** `badges.json` is a top-level array of badges. */
export const badgesFileSchema = z.array(badgeInputSchema);
export type BadgesFileInput = z.input<typeof badgesFileSchema>;
export type BadgesFile = z.output<typeof badgesFileSchema>;

// ─── learn/<track>.json ──────────────────────────────────────────────────

/** mcq: `answer` is the 0-based index of the right choice. short: accepted answer(s), case-insensitive. */
export const checkpointInputSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('mcq'),
        prompt_md: text,
        choices: z.array(text).min(2),
        answer: z.number().int().nonnegative(),
        explanation_md: z.string(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('short'),
        prompt_md: text,
        answer: z.union([text, z.array(text).min(1)]),
        explanation_md: z.string(),
      })
      .strict(),
  ])
  .superRefine((q, ctx) => {
    if (q.kind === 'mcq' && q.answer >= q.choices.length) {
      ctx.addIssue({ code: 'custom', message: 'answer must index into choices', path: ['answer'] });
    }
  });

/** A lesson (`ord` = position in the module). Slugs are unique within the whole track (route /learn/[track]/[lesson]). */
export const lessonInputSchema = z
  .object({
    slug: slugSchema,
    title: text,
    est_minutes: positiveInt,
    /** Topic slug this lesson teaches (optional). */
    topic: slugSchema.nullable().optional(),
    related_question_slugs: z.array(slugSchema).default([]),
    body_md: text,
  })
  .strict();

/** A module (`ord` = position in the track) with its lessons and optional checkpoint quiz. */
export const moduleInputSchema = z
  .object({
    slug: slugSchema,
    title: text,
    summary: z.string(),
    lessons: z.array(lessonInputSchema).min(1),
    checkpoint: z.array(checkpointInputSchema).default([]),
  })
  .strict();

export const trackFileSchema = z
  .object({
    slug: slugSchema,
    title: text,
    summary: z.string(),
    level: z.enum(['beginner', 'intermediate', 'advanced']),
    /** Tier slug the track belongs to (optional). */
    tier: slugSchema.nullable().optional(),
    est_hours: z.number().positive(),
    /** Display order on /learn (explicit: tracks live in separate files). */
    ord: z.number().int().nonnegative(),
    modules: z.array(moduleInputSchema).min(1),
  })
  .strict();
export type TrackFileInput = z.input<typeof trackFileSchema>;
export type TrackFile = z.output<typeof trackFileSchema>;

// ─── library/<area>.json ─────────────────────────────────────────────────

/** An article (`ord` = position in its chapter). Slugs are unique across the library. */
export const articleInputSchema = z
  .object({
    slug: slugSchema,
    title: text,
    summary: z.string(),
    difficulty: difficultySchema,
    reading_minutes: positiveInt,
    idea_md: text,
    formula: z.string().nullable().default(null),
    code_cpp: text,
    viz_id: z.string().nullable().default(null),
    applications_md: z.string(),
    pitfall_md: z.string(),
    practice_question_slugs: z.array(slugSchema).default([]),
    status: z.enum(['draft', 'published']).default('published'),
  })
  .strict();

export const chapterInputSchema = z
  .object({
    slug: slugSchema,
    title: text,
    articles: z.array(articleInputSchema).min(1),
  })
  .strict();

export const areaFileSchema = z
  .object({
    slug: slugSchema,
    title: text,
    summary: z.string(),
    icon: iconSchema,
    /** Display order on /library (explicit: areas live in separate files). */
    ord: z.number().int().nonnegative(),
    chapters: z.array(chapterInputSchema).min(1),
  })
  .strict();
export type AreaFileInput = z.input<typeof areaFileSchema>;
export type AreaFile = z.output<typeof areaFileSchema>;

// ─── A whole seed directory, parsed ──────────────────────────────────────

export interface Sourced<T> {
  /** Path relative to the seed directory, for error messages. */
  file: string;
  data: T;
}

export interface SeedBundle {
  dir: string;
  loop: Sourced<LoopFile>;
  questions: Sourced<QuestionFile>[];
  badges: Sourced<BadgesFile> | null;
  tracks: Sourced<TrackFile>[];
  areas: Sourced<AreaFile>[];
}
