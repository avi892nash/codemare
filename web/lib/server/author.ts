import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { compile, CompileServiceError, type RunRequest, type RunResponse } from '@/lib/compile';
import { consume, retryMessage, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import {
  DIFFICULTIES,
  HINT_LEVELS,
  LANGUAGES,
  type Difficulty,
  type PublishStatus,
  type Role,
  type SupportedLanguage,
  type TestDef,
} from '@/lib/types';
import {
  IDENTIFIER_RE,
  LIMITS,
  MAX_SOURCE_BYTES,
  SLUG_MAX,
  SLUG_RE,
  checklistPasses,
  computeChecklist,
  defaultHints,
  draftSignature,
  fromTestDefs,
  normalizeCompany,
  normalizeTag,
  parseArgs,
  parseExpected,
  parseTest,
  providedReferences,
  referenceFingerprint,
  testFitIssues,
  toTestDefs,
  zeroValue,
  type CheckItem,
  type DraftMeta,
  type QuestionDraft,
  type ReferenceRun,
  type ReferenceTestResult,
  type RunVerdictCode,
} from '@/components/Author/model';
import { prisma } from './db';
import { hasRole } from './rules/roles';
import { exampleSchema, signatureSchema, signatureTypeSchema, testDefSchema } from './schemas';

/**
 * Question authoring (artboard A1, spec §3.9 roles). Server-only.
 *
 *   · who may author (role ≥ author) and edit (the question's author, or staff+)
 *   · saving drafts — shape-valid but possibly incomplete
 *   · publishing — the full checklist (components/Author/model.ts) plus a
 *     fresh run of every reference solution against the tests; nothing is
 *     published unless all of it passes
 *   · running a reference solution through the compile service's /v1/run
 *
 * The pure rules live in components/Author/model.ts so the editor can show
 * the same checklist live; every one of them is re-run here.
 *
 * Authored questions start as drafts owned by their author. Drafts are only
 * reachable by the author and staff (canAccessQuestion in access.ts);
 * published ones go through the normal access rules.
 */

// ─── Viewer & permissions ────────────────────────────────────────────────

export interface AuthorViewer {
  id: string;
  role: Role;
  handle: string;
}

/**
 * The signed-in user with their *current* role, read from the database —
 * not the JWT, which only refreshes on sign-in — so a demotion takes effect
 * immediately.
 */
export async function getAuthorViewer(userId: string | null | undefined): Promise<AuthorViewer | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, handle: true } });
  return user;
}

/** /author/* needs role ≥ author (spec §3.9). */
export function canAuthor(role: Role | null | undefined): boolean {
  return hasRole(role, 'author');
}

/** Authors edit their own questions; staff and admins edit any. */
export function canEditQuestion(viewer: Pick<AuthorViewer, 'id' | 'role'>, question: { authorId: string | null }): boolean {
  if (!canAuthor(viewer.role)) return false;
  return question.authorId === viewer.id || hasRole(viewer.role, 'staff');
}

// ─── Results ─────────────────────────────────────────────────────────────

export interface FieldError {
  /** Dotted path into QuestionDraft, e.g. `tests.2.args`. */
  path: string;
  message: string;
}

export type SaveResult =
  | { ok: true; id: string; slug: string; status: PublishStatus; updatedAt: string }
  | {
      ok: false;
      code: 'invalid' | 'not_found' | 'conflict' | 'rate_limited' | 'checklist' | 'verification';
      error: string;
      fieldErrors?: FieldError[];
      checklist?: CheckItem[];
      runs?: ReferenceRun[];
    };

export type PublishResult = SaveResult & { runs?: ReferenceRun[] };

const fail = (code: Extract<SaveResult, { ok: false }>['code'], error: string, extra: Partial<Extract<SaveResult, { ok: false }>> = {}) =>
  ({ ok: false as const, code, error, ...extra });

// ─── Input schema ────────────────────────────────────────────────────────

const source = z.string().refine((s) => Buffer.byteLength(s, 'utf8') <= MAX_SOURCE_BYTES, 'over 64 KB');
const byLanguage = <T extends z.ZodTypeAny>(schema: T) =>
  z.object(Object.fromEntries(LANGUAGES.map((l) => [l, schema])) as Record<SupportedLanguage, T>);

/**
 * The wire shape of QuestionDraft. Size caps keep one request well under the
 * server-action body limit; unknown keys (client-only list keys) are dropped.
 */
export const draftInputSchema = z.object({
  id: z.string().min(1).max(64).nullable(),
  title: z.string().max(200),
  slug: z.string().max(120),
  difficulty: z.enum(DIFFICULTIES),
  topics: z.array(z.object({ slug: z.string().max(80), weight: z.number().finite() })).max(10),
  tags: z.array(z.string().max(80)).max(25),
  companies: z.array(z.string().max(80)).max(25),
  statementMd: z.string().max(50_000),
  constraints: z.array(z.string().max(500)).max(40),
  examples: z.array(z.object({ input: z.string().max(5000), output: z.string().max(5000), explanation: z.string().max(5000) })).max(20),
  functionName: z.string().max(60),
  params: z.array(z.object({ name: z.string().max(60), type: signatureTypeSchema })).max(12),
  returns: signatureTypeSchema,
  compareMode: z.enum(['ordered', 'unordered']),
  timeLimitMs: z.number().int().min(LIMITS.timeMs.min).max(LIMITS.timeMs.max),
  memoryLimitMb: z.number().int().min(LIMITS.memoryMb.min).max(LIMITS.memoryMb.max),
  starterCode: byLanguage(source),
  tests: z
    .array(
      z.object({
        args: z.string().max(100_000),
        expected: z.string().max(100_000),
        hidden: z.boolean(),
        explainOnFail: z.string().max(2000),
      })
    )
    .max(200),
  referenceSolutions: byLanguage(source),
  hints: z
    .array(
      z.object({
        level: z.enum(HINT_LEVELS),
        bodyMd: z.string().max(20_000),
        costKind: z.enum(['score', 'token']),
        costAmount: z.number().int().min(0).max(1000),
      })
    )
    .max(HINT_LEVELS.length),
  editorialMd: z.string().max(100_000),
});

function zodErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Parse + normalize a draft; `errors` lists everything that stops it from being stored at all. */
export function parseDraft(raw: unknown): { draft: QuestionDraft | null; errors: FieldError[] } {
  const r = draftInputSchema.safeParse(raw);
  if (!r.success) return { draft: null, errors: zodErrors(r.error) };
  const d = r.data;
  const dedupe = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const draft: QuestionDraft = {
    ...d,
    title: d.title.trim(),
    slug: d.slug.trim(),
    tags: dedupe(d.tags.map(normalizeTag)),
    companies: dedupe(d.companies.map(normalizeCompany)),
    constraints: d.constraints.map((c) => c.trim()).filter(Boolean),
    examples: d.examples.map((e) => ({ input: e.input.trim(), output: e.output.trim(), explanation: e.explanation.trim() })),
    functionName: d.functionName.trim(),
    params: d.params.map((p) => ({ name: p.name.trim(), type: p.type })),
    hints: HINT_LEVELS.map((level) => {
      const h = d.hints.find((x) => x.level === level);
      return h ?? defaultHints().find((x) => x.level === level)!;
    }),
  };

  // Structural rules: what every stored question must satisfy, draft or not
  // (other screens parse these columns with the shared schemas).
  const errors: FieldError[] = [];
  if (!draft.title) errors.push({ path: 'title', message: 'Give the question a title' });
  if (!SLUG_RE.test(draft.slug) || draft.slug.length > SLUG_MAX) {
    errors.push({ path: 'slug', message: 'The slug must be kebab-case: a–z, 0–9 and single dashes' });
  }
  if (draft.functionName && !IDENTIFIER_RE.test(draft.functionName)) {
    errors.push({ path: 'functionName', message: 'The function name must be an identifier' });
  }
  const names = new Set<string>();
  draft.params.forEach((p, i) => {
    if (!IDENTIFIER_RE.test(p.name)) errors.push({ path: `params.${i}.name`, message: `Parameter ${i + 1} needs an identifier name` });
    else if (names.has(p.name)) errors.push({ path: `params.${i}.name`, message: `Parameter "${p.name}" appears twice` });
    names.add(p.name);
  });
  const topicSlugs = new Set<string>();
  draft.topics.forEach((t, i) => {
    if (topicSlugs.has(t.slug)) errors.push({ path: `topics.${i}`, message: `Topic "${t.slug}" is listed twice` });
    topicSlugs.add(t.slug);
    if (!(t.weight > 0 && t.weight <= 10)) errors.push({ path: `topics.${i}.weight`, message: 'Weights are between 0 and 10' });
  });
  draft.tests.forEach((t, i) => {
    const p = parseTest(t);
    if (!p.ok) errors.push({ path: `tests.${i}.${p.field}`, message: `Test ${i + 1}: ${p.message}` });
  });
  draft.hints.forEach((h, i) => {
    if (h.costKind === 'score' && h.costAmount > 100) {
      errors.push({ path: `hints.${i}.costAmount`, message: 'A score cost is a percentage (0–100)' });
    }
  });
  return { draft, errors };
}

// ─── Reading ─────────────────────────────────────────────────────────────

export interface TopicOption {
  slug: string;
  title: string;
  tier: string;
  tierOrd: number;
}

/** Every topic, grouped-by-tier order, for the topic picker. */
export async function listTopicOptions(): Promise<TopicOption[]> {
  const rows = await prisma.topic.findMany({
    select: { slug: true, title: true, ord: true, tier: { select: { title: true, ord: true } } },
    orderBy: [{ tier: { ord: 'asc' } }, { ord: 'asc' }],
  });
  return rows.map((t) => ({ slug: t.slug, title: t.title, tier: t.tier.title, tierOrd: t.tier.ord }));
}

/** Tags and companies already used by published questions, for the editor's suggestions. */
export async function listTagSuggestions(): Promise<{ tags: string[]; companies: string[] }> {
  const [tags, companies] = await Promise.all([
    prisma.$queryRaw<{ v: string }[]>`
      SELECT DISTINCT unnest(tags) AS v FROM content.questions WHERE status = 'published' ORDER BY 1`,
    prisma.$queryRaw<{ v: string }[]>`
      SELECT DISTINCT unnest(companies) AS v FROM content.questions WHERE status = 'published' ORDER BY 1`,
  ]);
  return { tags: tags.map((r) => r.v), companies: companies.map((r) => r.v) };
}

export interface AuthoredQuestionRow {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  status: PublishStatus;
  updatedAt: Date;
  tests: number;
  hiddenTests: number;
  topics: string[];
  authorHandle: string | null;
  mine: boolean;
}

/**
 * The /author list: the viewer's own questions, or (staff+, `scope: 'all'`)
 * every question — seeded ones included — since staff may edit any.
 */
export async function listAuthoredQuestions(
  viewer: AuthorViewer,
  scope: 'mine' | 'all' = 'mine'
): Promise<AuthoredQuestionRow[]> {
  const all = scope === 'all' && hasRole(viewer.role, 'staff');
  const rows = await prisma.question.findMany({
    where: all ? {} : { authorId: viewer.id },
    orderBy: [{ updatedAt: 'desc' }],
    take: 500,
    select: {
      id: true,
      slug: true,
      title: true,
      difficulty: true,
      status: true,
      updatedAt: true,
      tests: true,
      authorId: true,
      author: { select: { handle: true } },
      topics: { select: { topic: { select: { title: true } } }, orderBy: { weight: 'desc' } },
    },
  });
  return rows.map((q) => {
    const tests = Array.isArray(q.tests) ? (q.tests as { hidden?: unknown }[]) : [];
    return {
      id: q.id,
      slug: q.slug,
      title: q.title,
      difficulty: q.difficulty,
      status: q.status,
      updatedAt: q.updatedAt,
      tests: tests.length,
      hiddenTests: tests.filter((t) => t && t.hidden === true).length,
      topics: q.topics.map((t) => t.topic.title),
      authorHandle: q.author?.handle ?? null,
      mine: q.authorId === viewer.id,
    };
  });
}

function codeMap(value: unknown): Record<SupportedLanguage, string> {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(LANGUAGES.map((l) => [l, typeof obj[l] === 'string' ? (obj[l] as string) : ''])) as Record<
    SupportedLanguage,
    string
  >;
}

/**
 * A question as an editor draft, or null when it does not exist or the
 * viewer may not edit it (the page answers both with the same 404).
 * Tolerates malformed legacy rows: bad JSON columns fall back to defaults.
 */
export async function loadQuestionDraft(
  viewer: AuthorViewer,
  id: string
): Promise<{ draft: QuestionDraft; meta: DraftMeta } | null> {
  const q = await prisma.question.findUnique({
    where: { id },
    include: {
      author: { select: { handle: true } },
      topics: { include: { topic: { select: { slug: true } } }, orderBy: { weight: 'desc' } },
      hints: true,
    },
  });
  if (!q || !canEditQuestion(viewer, q)) return null;

  const sig = signatureSchema.safeParse(q.signature);
  const examples = Array.isArray(q.examples) ? q.examples.flatMap((e) => {
    const r = exampleSchema.safeParse(e);
    return r.success ? [{ input: r.data.input, output: r.data.output, explanation: r.data.explanation ?? '' }] : [];
  }) : [];
  const tests = Array.isArray(q.tests)
    ? q.tests.flatMap((t) => {
        const r = testDefSchema.safeParse(t);
        return r.success ? [r.data as TestDef] : [];
      })
    : [];
  const hints = defaultHints().map((d) => {
    const h = q.hints.find((x) => x.level === d.level);
    return h ? { level: h.level, bodyMd: h.bodyMd, costKind: h.costKind, costAmount: h.costAmount } : d;
  });

  const draft: QuestionDraft = {
    id: q.id,
    title: q.title,
    slug: q.slug,
    difficulty: q.difficulty,
    topics: q.topics.map((t) => ({ slug: t.topic.slug, weight: t.weight })),
    tags: q.tags,
    companies: q.companies,
    statementMd: q.statementMd,
    constraints: Array.isArray(q.constraints) ? q.constraints.filter((c): c is string => typeof c === 'string') : [],
    examples,
    functionName: q.functionName,
    params: sig.success ? sig.data.params : [],
    returns: sig.success ? sig.data.returns : 'int',
    compareMode: q.compareMode,
    timeLimitMs: Math.min(LIMITS.timeMs.max, Math.max(LIMITS.timeMs.min, q.timeLimitMs)),
    memoryLimitMb: Math.min(LIMITS.memoryMb.max, Math.max(LIMITS.memoryMb.min, q.memoryLimitMb)),
    starterCode: codeMap(q.starterCode),
    tests: fromTestDefs(tests),
    referenceSolutions: codeMap(q.referenceSolutions),
    hints,
    editorialMd: q.editorialMd ?? '',
  };
  return {
    draft,
    meta: { status: q.status, updatedAt: q.updatedAt.toISOString(), authorHandle: q.author?.handle ?? null },
  };
}

// ─── Writing ─────────────────────────────────────────────────────────────

async function topicIdsBySlug(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const rows = await prisma.topic.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  return new Map(rows.map((r) => [r.slug, r.id]));
}

function nonEmptyCode(map: Record<SupportedLanguage, string>): Partial<Record<SupportedLanguage, string>> {
  return Object.fromEntries(LANGUAGES.filter((l) => map[l].trim()).map((l) => [l, map[l]]));
}

type Existing = { id: string; authorId: string | null; status: PublishStatus; slug: string };

async function loadExisting(viewer: AuthorViewer, id: string | null): Promise<Existing | null | 'forbidden'> {
  if (!id) return null;
  const q = await prisma.question.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, slug: true } });
  if (!q || !canEditQuestion(viewer, q)) return 'forbidden';
  return q;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Write the question row, its topics and its hint ladder in one
 * transaction. Hint levels the draft leaves empty are deleted unless a
 * learner already revealed them (their penalty history stays intact).
 */
async function writeQuestion(
  viewer: AuthorViewer,
  existing: Existing | null,
  draft: QuestionDraft,
  status: PublishStatus,
  topicIds: Map<string, string>
): Promise<{ id: string; slug: string; status: PublishStatus; updatedAt: Date }> {
  const data = {
    slug: draft.slug,
    title: draft.title,
    difficulty: draft.difficulty,
    statementMd: draft.statementMd,
    examples: draft.examples.map((e) => ({
      input: e.input,
      output: e.output,
      ...(e.explanation ? { explanation: e.explanation } : {}),
    })),
    constraints: draft.constraints,
    functionName: draft.functionName,
    signature: draftSignature(draft) as unknown as Prisma.InputJsonValue,
    compareMode: draft.compareMode,
    starterCode: nonEmptyCode(draft.starterCode),
    tests: toTestDefs(draft.tests) as unknown as Prisma.InputJsonValue,
    referenceSolutions: nonEmptyCode(draft.referenceSolutions),
    tags: draft.tags,
    companies: draft.companies,
    editorialMd: draft.editorialMd.trim() ? draft.editorialMd : null,
    status,
    timeLimitMs: draft.timeLimitMs,
    memoryLimitMb: draft.memoryLimitMb,
  };

  return prisma.$transaction(async (tx) => {
    const row = existing
      ? await tx.question.update({ where: { id: existing.id }, data, select: { id: true, slug: true, status: true, updatedAt: true } })
      : await tx.question.create({
          data: { ...data, authorId: viewer.id },
          select: { id: true, slug: true, status: true, updatedAt: true },
        });

    await tx.questionTopic.deleteMany({ where: { questionId: row.id } });
    if (draft.topics.length) {
      await tx.questionTopic.createMany({
        data: draft.topics.map((t) => ({ questionId: row.id, topicId: topicIds.get(t.slug)!, weight: t.weight })),
      });
    }

    const written = draft.hints.filter((h) => h.bodyMd.trim());
    for (const h of written) {
      const hint = { bodyMd: h.bodyMd, costKind: h.costKind, costAmount: h.costAmount };
      await tx.hint.upsert({
        where: { questionId_level: { questionId: row.id, level: h.level } },
        create: { questionId: row.id, level: h.level, ...hint },
        update: hint,
      });
    }
    await tx.hint.deleteMany({
      where: { questionId: row.id, level: { notIn: written.map((h) => h.level) }, uses: { none: {} } },
    });
    return row;
  });
}

/** Everything saveDraft and publish share: parse, permissions, topic and slug checks. */
async function prepare(
  viewer: AuthorViewer,
  raw: unknown
): Promise<
  | { ok: true; draft: QuestionDraft; existing: Existing | null; topicIds: Map<string, string> }
  | Extract<SaveResult, { ok: false }>
> {
  if (!canAuthor(viewer.role)) return fail('not_found', 'Not found');
  const { draft, errors } = parseDraft(raw);
  if (!draft) return fail('invalid', 'The draft is malformed', { fieldErrors: errors });

  const existing = await loadExisting(viewer, draft.id);
  if (existing === 'forbidden') return fail('not_found', 'That question does not exist or is not yours to edit');

  const topicIds = await topicIdsBySlug(draft.topics.map((t) => t.slug));
  draft.topics.forEach((t, i) => {
    if (!topicIds.has(t.slug)) errors.push({ path: `topics.${i}`, message: `Unknown topic "${t.slug}"` });
  });
  if (existing?.status === 'published' && draft.slug !== existing.slug) {
    errors.push({ path: 'slug', message: 'A published question keeps its slug (links point at it)' });
  }
  if (SLUG_RE.test(draft.slug)) {
    const clash = await prisma.question.findUnique({ where: { slug: draft.slug }, select: { id: true } });
    if (clash && clash.id !== existing?.id) errors.push({ path: 'slug', message: `The slug "${draft.slug}" is already taken` });
  }
  if (errors.length) return fail('invalid', errors[0].message, { fieldErrors: errors });
  return { ok: true, draft, existing, topicIds };
}

/**
 * Save a draft (create on first save). Drafts may be incomplete but must be
 * shape-valid. A published question is not saved as a draft: unpublish it
 * first, or publish the changes (which re-runs the checklist).
 */
export async function saveDraft(viewer: AuthorViewer, raw: unknown): Promise<SaveResult> {
  const prep = await prepare(viewer, raw);
  if (!prep.ok) return prep;
  if (prep.existing?.status === 'published') {
    return fail('conflict', 'This question is published. Publish your changes, or unpublish it to keep editing a draft.');
  }
  try {
    const row = await writeQuestion(viewer, prep.existing, prep.draft, 'draft', prep.topicIds);
    return { ok: true, id: row.id, slug: row.slug, status: row.status, updatedAt: row.updatedAt.toISOString() };
  } catch (e) {
    if (isUniqueViolation(e)) return fail('invalid', `The slug "${prep.draft.slug}" is already taken`, { fieldErrors: [{ path: 'slug', message: 'Slug taken' }] });
    throw e;
  }
}

/**
 * Publish (or re-publish changes to) a question. Requires every checklist
 * item: the static ones straight from the draft, and "reference passes every
 * test" from a fresh run of every provided reference solution — the
 * client's earlier runs are never trusted. Nothing is written on failure.
 */
export async function publishQuestion(viewer: AuthorViewer, raw: unknown): Promise<PublishResult> {
  const prep = await prepare(viewer, raw);
  if (!prep.ok) return prep;
  const { draft } = prep;

  const known = new Set(prep.topicIds.keys());
  const staticItems = computeChecklist(draft, { knownTopics: known }).filter((i) => !i.dynamic);
  const missing = staticItems.filter((i) => !i.ok);
  if (missing.length) {
    return fail('checklist', `Finish the checklist first: ${missing[0].problems[0] ?? missing[0].label}`, {
      checklist: computeChecklist(draft, { knownTopics: known }),
    });
  }

  // Every provided reference, in parallel (the compile service queues them).
  const results = await Promise.all(providedReferences(draft).map((language) => runReferenceFor(viewer, draft, language)));
  const refused = results.find((r): r is Extract<ReferenceRunResult, { ok: false }> => !r.ok);
  if (refused) return fail(refused.code, refused.error);
  const runs = results.map((r) => (r as Extract<ReferenceRunResult, { ok: true }>).run);
  const checklist = computeChecklist(draft, {
    knownTopics: known,
    runs: Object.fromEntries(runs.map((r) => [r.language, r])),
  });
  if (!checklistPasses(checklist)) {
    const ref = checklist.find((i) => i.key === 'reference');
    return fail('verification', ref?.problems[0] ?? 'A reference solution does not pass every test', { checklist, runs });
  }

  try {
    const row = await writeQuestion(viewer, prep.existing, draft, 'published', prep.topicIds);
    return { ok: true, id: row.id, slug: row.slug, status: row.status, updatedAt: row.updatedAt.toISOString(), runs };
  } catch (e) {
    if (isUniqueViolation(e)) return fail('invalid', `The slug "${draft.slug}" is already taken`);
    throw e;
  }
}

/** Take a published question back to draft (hidden from learners again). */
export async function unpublishQuestion(viewer: AuthorViewer, id: string): Promise<SaveResult> {
  const existing = await loadExisting(viewer, id);
  if (!existing || existing === 'forbidden') return fail('not_found', 'That question does not exist or is not yours to edit');
  const row = await prisma.question.update({
    where: { id },
    data: { status: 'draft' },
    select: { id: true, slug: true, status: true, updatedAt: true },
  });
  return { ok: true, id: row.id, slug: row.slug, status: row.status, updatedAt: row.updatedAt.toISOString() };
}

/**
 * Delete a draft nobody has submitted to and no gate uses. Published
 * questions are never deleted here (unpublish first).
 */
export async function deleteDraft(viewer: AuthorViewer, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await loadExisting(viewer, id);
  if (!existing || existing === 'forbidden') return { ok: false, error: 'That question does not exist or is not yours to edit' };
  if (existing.status !== 'draft') return { ok: false, error: 'Unpublish the question before deleting it' };
  const [submissions, gates] = await Promise.all([
    prisma.submission.count({ where: { questionId: id } }),
    prisma.gateQuestion.count({ where: { questionId: id } }),
  ]);
  if (submissions > 0 || gates > 0) return { ok: false, error: 'Learners have submitted to this question; it cannot be deleted' };
  await prisma.question.delete({ where: { id } });
  return { ok: true };
}

// ─── Reference runs ──────────────────────────────────────────────────────

export type ReferenceRunResult = { ok: true; run: ReferenceRun } | { ok: false; code: 'invalid' | 'rate_limited' | 'not_found'; error: string };

const runInputSchema = z.object({ draft: z.unknown(), language: z.enum(LANGUAGES) });

/**
 * Map the compile service's answer onto what the editor shows. Tests in
 * `missing` ran against a placeholder expected value: never count them as
 * passed.
 */
export function toReferenceRun(
  language: SupportedLanguage,
  res: RunResponse,
  fingerprint: string,
  missing: ReadonlySet<number> = new Set()
): ReferenceRun {
  const tests: ReferenceTestResult[] = (res.tests ?? []).map((t) => ({
    idx: t.idx,
    passed: t.passed && !missing.has(t.idx),
    hidden: t.hidden,
    actual: t.actual === undefined ? null : t.actual,
    hasActual: t.actual !== undefined && !t.error,
    expectedMissing: missing.has(t.idx),
    error: t.error ?? null,
    runUs: t.runUs ?? 0,
    memoryKb: t.memoryKb ?? 0,
  }));
  const allPassed = tests.length === res.totalTests && tests.every((t) => t.passed);
  // Never report OK unless every test really passed.
  const status: RunVerdictCode = res.status === 'OK' && !allPassed ? 'WA' : res.status;
  return {
    language,
    status,
    totalPassed: tests.length ? tests.filter((t) => t.passed).length : res.totalPassed,
    totalTests: res.totalTests,
    compileMs: res.compileMs ?? null,
    error: res.error ?? null,
    tests,
    fingerprint,
  };
}

/**
 * Run one language's reference solution against the draft's tests through
 * the compile service (/v1/run). Counts against the per-user submission
 * rate limit (the same bucket as Run / Submit). `raw` is `{ draft, language }`.
 */
export async function runReference(viewer: AuthorViewer, raw: unknown): Promise<ReferenceRunResult> {
  if (!canAuthor(viewer.role)) return { ok: false, code: 'not_found', error: 'Not found' };
  const input = runInputSchema.safeParse(raw);
  if (!input.success) return { ok: false, code: 'invalid', error: 'Malformed run request' };
  const { draft, errors } = parseDraft(input.data.draft);
  if (!draft) return { ok: false, code: 'invalid', error: errors[0]?.message ?? 'Malformed draft' };
  return runReferenceFor(viewer, draft, input.data.language);
}

/** runReference for a draft that already went through parseDraft. */
async function runReferenceFor(viewer: AuthorViewer, draft: QuestionDraft, language: SupportedLanguage): Promise<ReferenceRunResult> {
  const code = draft.referenceSolutions[language];
  if (!code.trim()) return { ok: false, code: 'invalid', error: `There is no ${language} reference solution yet` };
  if (!IDENTIFIER_RE.test(draft.functionName)) return { ok: false, code: 'invalid', error: 'Set a valid function name first' };
  if (draft.tests.length === 0) return { ok: false, code: 'invalid', error: 'Add a test first' };

  const signature = draftSignature(draft);
  const typed = language === 'cpp' || language === 'java' || language === 'go';
  const tests: RunRequest['tests'] = [];
  // Tests still missing an expected output run against a typed placeholder;
  // their results are flagged so the editor can fill them from the output.
  const missing = new Set<number>();
  for (const [i, t] of draft.tests.entries()) {
    const args = parseArgs(t.args);
    if (!args.ok) return { ok: false, code: 'invalid', error: `Test ${i + 1}: ${args.message}` };
    const exp = parseExpected(t.expected);
    const expected = exp.ok ? exp.expected : zeroValue(draft.returns);
    if (!exp.ok) missing.add(i);
    if (typed) {
      const issues = testFitIssues(signature, args.input, expected);
      if (issues.length) return { ok: false, code: 'invalid', error: `Test ${i + 1} ${issues[0]}` };
    }
    tests.push({ input: args.input, expected, hidden: t.hidden });
  }

  const limit = consume(`submit:${viewer.id}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
  if (!limit.ok) return { ok: false, code: 'rate_limited', error: retryMessage(limit.retryAfterSec) };

  const fingerprint = referenceFingerprint(draft, language);
  const request: RunRequest = {
    language,
    code,
    functionName: draft.functionName,
    signature,
    compareMode: draft.compareMode,
    tests,
    limits: { timeMs: draft.timeLimitMs, memoryMb: draft.memoryLimitMb },
  };
  try {
    return { ok: true, run: toReferenceRun(language, await compile.run(request), fingerprint, missing) };
  } catch (e) {
    const message =
      e instanceof CompileServiceError
        ? e.status === 400
          ? `The judge rejected the request: ${e.message.replace(/^compile service \d+: /, '').slice(0, 300)}`
          : `The judge is unavailable (${e.status}). Try again in a moment.`
        : 'The judge is unreachable. Try again in a moment.';
    return {
      ok: true,
      run: { language, status: 'XX', totalPassed: 0, totalTests: tests.length, compileMs: null, error: message, tests: [], fingerprint },
    };
  }
}
