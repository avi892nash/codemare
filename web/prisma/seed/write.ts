/**
 * Write a validated seed bundle to the content schema, in one transaction,
 * in one of two modes (mode.ts, spec §6.1).
 *
 * upsert — the JSON files are the source of truth. Top-level entities upsert
 * by slug (ids survive re-seeds, so user progress keeps pointing at the same
 * rows); owned sets are made equal to the files — join rows (question topics,
 * gate questions) by their natural pair, so their ids survive too; recipe
 * items and checkpoint questions are replaced; ordered children (recipes,
 * modules, lessons, chapters, articles, hints) upsert by their natural key
 * and stale ones are deleted — unless users already touched them, in which
 * case they are kept and reported as warnings.
 *
 * insert-missing — the database is the source of truth (staff edit content in
 * Directus). A row is created only when its natural key does not exist yet,
 * together with everything it owns; an existing row is never updated or
 * deleted, and nothing is added under it:
 *
 *   natural key          created with it (only when it is new)
 *   tier slug            —
 *   topic slug           its recipes and their items
 *   question slug        its topics + weights and its hints (tests are a column)
 *   gate (its tier)      its questions, in order
 *   badge slug           —
 *   track slug           its modules, lessons and checkpoint questions
 *   library area slug    its chapters and articles
 *
 * References from new rows resolve by slug to whatever row exists (edited or
 * not). A new tier whose ord an existing tier holds is refused (nothing is
 * written); a new area's article whose slug already exists elsewhere is
 * skipped with a warning.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { SeedError } from './load';
import { DEFAULT_SEED_MODE, type SeedMode } from './mode';
import type { Hint, SeedBundle } from './types';

type Tx = Prisma.TransactionClient;
type Ids = Map<string, string>;
type Count = (kind: string, n?: number) => void;

export interface SeedSummary {
  mode: SeedMode;
  /** Rows written (upsert) or created (insert-missing), by kind. */
  counts: Record<string, number>;
  /** insert-missing only: existing rows left exactly as they were, by kind. */
  kept: Record<string, number>;
  warnings: string[];
}

interface Ctx {
  tx: Tx;
  seed: SeedBundle;
  mode: SeedMode;
  warnings: string[];
  count: Count;
  keep: Count;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function writeSeed(
  prisma: PrismaClient,
  seed: SeedBundle,
  opts: { mode?: SeedMode } = {}
): Promise<SeedSummary> {
  const mode = opts.mode ?? DEFAULT_SEED_MODE;
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const kept: Record<string, number> = {};
  const tally = (into: Record<string, number>): Count => (k, n = 1) => {
    into[k] = (into[k] ?? 0) + n;
  };

  await prisma.$transaction(
    async (tx) => {
      const ctx: Ctx = { tx, seed, mode, warnings, count: tally(counts), keep: tally(kept) };
      const tierIds = await writeTiers(ctx);
      const { ids: topicIds, written: writtenTopics } = await writeTopics(ctx, tierIds);
      const questionIds = await writeQuestions(ctx, topicIds);
      await writeRecipes(ctx, topicIds, writtenTopics);
      await writeGates(ctx, tierIds, questionIds);
      await writeBadges(ctx);
      await writeLearn(ctx, tierIds, topicIds);
      await writeLibrary(ctx);
    },
    { maxWait: 30_000, timeout: 300_000 }
  );
  return { mode, counts, kept, warnings };
}

/** insert-missing: which of `slugs` already exist (slug → id). */
async function existingBySlug(
  find: (slugs: string[]) => Promise<{ id: string; slug: string }[]>,
  slugs: string[]
): Promise<Ids> {
  return new Map((await find(slugs)).map((r) => [r.slug, r.id]));
}

// ─── loop ────────────────────────────────────────────────────────────────

async function writeTiers({ tx, seed, mode, count, keep }: Ctx): Promise<Ids> {
  const tiers = seed.loop.data.tiers;
  const existing = await tx.tier.findMany({ select: { id: true, slug: true, ord: true } });
  const ids: Ids = new Map();

  if (mode === 'insert-missing') {
    const bySlug = new Map(existing.map((e) => [e.slug, e]));
    const missing = tiers.filter((t) => !bySlug.has(t.slug));
    const clashes = missing.flatMap((t) => {
      const holder = existing.find((e) => e.ord === t.ord);
      return holder ? [`tier "${t.slug}" needs ord ${t.ord}, which tier "${holder.slug}" holds — renumber one of them`] : [];
    });
    if (clashes.length) throw new SeedError(clashes, 'insert-missing cannot create these tiers');
    for (const t of tiers) {
      const found = bySlug.get(t.slug);
      if (found) {
        ids.set(t.slug, found.id);
        keep('tiers');
        continue;
      }
      const row = await tx.tier.create({ data: { slug: t.slug, ord: t.ord, title: t.title, summary: t.summary } });
      ids.set(t.slug, row.id);
      count('tiers');
    }
    return ids;
  }

  const wanted = new Map(tiers.map((t) => [t.slug, t]));
  const squatters = tiers.flatMap((t) => {
    const s = existing.find((e) => e.ord === t.ord && e.slug !== t.slug && !wanted.has(e.slug));
    return s ? [`tier ord ${t.ord} is held by tier "${s.slug}", which is not in the seed data — remove or renumber it`] : [];
  });
  if (squatters.length) throw new SeedError(squatters, 'seed conflicts with the database');

  // tiers.ord is unique: park tiers that move on temporary negative ords first.
  let parking = -1;
  for (const e of existing) {
    const t = wanted.get(e.slug);
    if (t && t.ord !== e.ord) await tx.tier.update({ where: { id: e.id }, data: { ord: parking-- } });
  }
  for (const t of tiers) {
    const data = { ord: t.ord, title: t.title, summary: t.summary };
    const row = await tx.tier.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...data }, update: data });
    ids.set(t.slug, row.id);
  }
  count('tiers', ids.size);
  return ids;
}

/** Topic ids by slug, and the slugs written now (insert-missing: only the new ones). */
async function writeTopics({ tx, seed, mode, count, keep }: Ctx, tierIds: Ids): Promise<{ ids: Ids; written: Set<string> }> {
  const topics = seed.loop.data.topics;
  const existing =
    mode === 'insert-missing'
      ? await existingBySlug((slugs) => tx.topic.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }), topics.map((t) => t.slug))
      : new Map<string, string>();
  const ids: Ids = new Map();
  const written = new Set<string>();
  const position = new Map<string, number>();
  for (const t of topics) {
    const ord = t.ord ?? position.get(t.tier) ?? 0;
    position.set(t.tier, (position.get(t.tier) ?? 0) + 1);
    const found = existing.get(t.slug);
    if (found) {
      ids.set(t.slug, found);
      keep('topics');
      continue;
    }
    const data = { tierId: tierIds.get(t.tier)!, title: t.title, summary: t.summary, icon: t.icon, ord };
    const row =
      mode === 'insert-missing'
        ? await tx.topic.create({ data: { slug: t.slug, ...data } })
        : await tx.topic.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...data }, update: data });
    ids.set(t.slug, row.id);
    written.add(t.slug);
    count('topics');
  }
  return { ids, written };
}

/** The recipes of the topics written now (insert-missing: only topics created in this run). */
async function writeRecipes({ tx, seed, mode, count }: Ctx, topicIds: Ids, writtenTopics: ReadonlySet<string>): Promise<void> {
  for (const topic of seed.loop.data.topics) {
    if (!writtenTopics.has(topic.slug)) continue;
    const topicId = topicIds.get(topic.slug)!;
    const recipes = seed.loop.data.recipes.filter((r) => r.topic === topic.slug);
    const existing = mode === 'upsert' ? await tx.unlockRecipe.findMany({ where: { topicId }, orderBy: { ord: 'asc' } }) : [];
    for (const [ord, r] of recipes.entries()) {
      const match = existing.find((e) => e.ord === ord);
      const { id } = match
        ? await tx.unlockRecipe.update({ where: { id: match.id }, data: { title: r.title } })
        : await tx.unlockRecipe.create({ data: { topicId, title: r.title, ord } });
      if (match) await tx.recipeItem.deleteMany({ where: { recipeId: id } });
      await tx.recipeItem.createMany({
        data: r.items.map((it) => ({
          recipeId: id,
          tokenTopicId: topicIds.get(it.topic)!,
          quantity: it.quantity,
          minDifficulty: it.min_difficulty,
        })),
      });
      count('recipes');
    }
    // unlocks.via_recipe_id is ON DELETE SET NULL: dropping a recipe keeps unlocks.
    if (mode === 'upsert') await tx.unlockRecipe.deleteMany({ where: { topicId, ord: { gte: recipes.length } } });
  }
}

/**
 * A question's hint ladder. upsert: by (question, level), pruning levels the
 * files dropped unless users revealed them. insert-missing: only called for a
 * new question.
 */
async function syncHints(
  { tx, mode, warnings, count }: Ctx,
  questionId: string,
  hints: readonly Hint[],
  where: string
): Promise<void> {
  count('hints', hints.length);
  if (mode === 'insert-missing') {
    if (hints.length) {
      await tx.hint.createMany({
        data: hints.map((h) => ({ questionId, level: h.level, bodyMd: h.body_md, costKind: h.cost_kind, costAmount: h.cost_amount })),
      });
    }
    return;
  }
  for (const h of hints) {
    const data = { bodyMd: h.body_md, costKind: h.cost_kind, costAmount: h.cost_amount };
    await tx.hint.upsert({
      where: { questionId_level: { questionId, level: h.level } },
      create: { questionId, level: h.level, ...data },
      update: data,
    });
  }
  const stale = await tx.hint.findMany({
    where: { questionId, level: { notIn: hints.map((h) => h.level) } },
    select: { id: true, level: true, _count: { select: { uses: true } } },
  });
  for (const s of stale) {
    if (s._count.uses > 0) warnings.push(`${where}: hint "${s.level}" was removed but users revealed it — kept`);
    else await tx.hint.delete({ where: { id: s.id } });
  }
}

async function writeGates({ tx, seed, mode, count, keep }: Ctx, tierIds: Ids, questionIds: Ids): Promise<void> {
  for (const g of seed.loop.data.gates) {
    const tierId = tierIds.get(g.tier)!;
    if (mode === 'insert-missing' && (await tx.gate.findUnique({ where: { tierId }, select: { id: true } }))) {
      keep('gates');
      continue;
    }
    const data = {
      title: g.title,
      summary: g.summary,
      passThreshold: g.pass_threshold,
      cooldownHours: g.cooldown_hours,
      timeLimitMinutes: g.time_limit_minutes,
    };
    const gate =
      mode === 'insert-missing'
        ? await tx.gate.create({ data: { tierId, ...data } })
        : await tx.gate.upsert({ where: { tierId }, create: { tierId, ...data }, update: data });
    const wanted = g.questions.map((slug, ord) => ({ questionId: questionIds.get(slug)!, ord }));
    if (mode === 'insert-missing') {
      await tx.gateQuestion.createMany({ data: wanted.map((w) => ({ gateId: gate.id, ...w })) });
    } else {
      await tx.gateQuestion.deleteMany({ where: { gateId: gate.id, questionId: { notIn: wanted.map((w) => w.questionId) } } });
      for (const w of wanted) {
        await tx.gateQuestion.upsert({
          where: { gateId_questionId: { gateId: gate.id, questionId: w.questionId } },
          create: { gateId: gate.id, ...w },
          update: { ord: w.ord },
        });
      }
    }
    count('gates');
  }
}

// ─── questions, badges ───────────────────────────────────────────────────

async function writeQuestions(ctx: Ctx, topicIds: Ids): Promise<Ids> {
  const { tx, seed, mode, count, keep } = ctx;
  const existing =
    mode === 'insert-missing'
      ? await existingBySlug(
          (slugs) => tx.question.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }),
          seed.questions.map((q) => q.data.slug)
        )
      : new Map<string, string>();
  const ids: Ids = new Map();
  for (const { file, data: q } of seed.questions) {
    const found = existing.get(q.slug);
    if (found) {
      ids.set(q.slug, found);
      keep('questions');
      continue;
    }
    const data = {
      title: q.title,
      difficulty: q.difficulty,
      statementMd: q.statement_md,
      examples: json(q.examples),
      constraints: json(q.constraints),
      functionName: q.function_name,
      signature: json(q.signature),
      compareMode: q.compare_mode,
      starterCode: json(q.starter_code),
      tests: json(q.tests),
      referenceSolutions: json(q.reference_solutions),
      tags: q.tags,
      companies: q.companies,
      editorialMd: q.editorial_md,
      status: q.status,
      timeLimitMs: q.time_limit_ms,
      memoryLimitMb: q.memory_limit_mb,
    };
    const row =
      mode === 'insert-missing'
        ? await tx.question.create({ data: { slug: q.slug, ...data } })
        : await tx.question.upsert({ where: { slug: q.slug }, create: { slug: q.slug, ...data }, update: data });
    ids.set(q.slug, row.id);
    count('questions');

    const topics = q.topics.map((t) => ({ topicId: topicIds.get(t.slug)!, weight: t.weight }));
    if (mode === 'insert-missing') {
      await tx.questionTopic.createMany({ data: topics.map((t) => ({ questionId: row.id, ...t })) });
    } else {
      await tx.questionTopic.deleteMany({ where: { questionId: row.id, topicId: { notIn: topics.map((t) => t.topicId) } } });
      for (const t of topics) {
        await tx.questionTopic.upsert({
          where: { questionId_topicId: { questionId: row.id, topicId: t.topicId } },
          create: { questionId: row.id, ...t },
          update: { weight: t.weight },
        });
      }
    }
    await syncHints(ctx, row.id, q.hints, file);
  }
  return ids;
}

async function writeBadges({ tx, seed, mode, count, keep }: Ctx): Promise<void> {
  const badges = seed.badges?.data ?? [];
  const existing =
    mode === 'insert-missing'
      ? await existingBySlug((slugs) => tx.badge.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }), badges.map((b) => b.slug))
      : new Map<string, string>();
  for (const [i, b] of badges.entries()) {
    if (existing.has(b.slug)) {
      keep('badges');
      continue;
    }
    const data = {
      name: b.name,
      description: b.description,
      icon: b.icon,
      rarity: b.rarity,
      criteria: json(b.criteria),
      ord: b.ord ?? i,
    };
    if (mode === 'insert-missing') await tx.badge.create({ data: { slug: b.slug, ...data } });
    else await tx.badge.upsert({ where: { slug: b.slug }, create: { slug: b.slug, ...data }, update: data });
    count('badges');
  }
}

// ─── learn ───────────────────────────────────────────────────────────────

async function writeLearn({ tx, seed, mode, warnings, count, keep }: Ctx, tierIds: Ids, topicIds: Ids): Promise<void> {
  const existing =
    mode === 'insert-missing'
      ? await existingBySlug(
          (slugs) => tx.track.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }),
          seed.tracks.map((t) => t.data.slug)
        )
      : new Map<string, string>();
  for (const { file, data: t } of seed.tracks) {
    if (existing.has(t.slug)) {
      keep('tracks');
      continue;
    }
    const trackData = {
      title: t.title,
      summary: t.summary,
      level: t.level,
      tierId: t.tier ? tierIds.get(t.tier)! : null,
      estHours: t.est_hours,
      ord: t.ord,
    };
    // insert-missing reaches here only for a new track: every upsert below creates.
    const track = await tx.track.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...trackData }, update: trackData });
    count('tracks');

    for (const [mi, m] of t.modules.entries()) {
      const modData = { title: m.title, summary: m.summary, ord: mi };
      const mod = await tx.learnModule.upsert({
        where: { trackId_slug: { trackId: track.id, slug: m.slug } },
        create: { trackId: track.id, slug: m.slug, ...modData },
        update: modData,
      });
      count('modules');

      for (const [li, l] of m.lessons.entries()) {
        const lessonData = {
          title: l.title,
          ord: li,
          bodyMd: l.body_md,
          estMinutes: l.est_minutes,
          topicId: l.topic ? topicIds.get(l.topic)! : null,
          relatedQuestionSlugs: l.related_question_slugs,
        };
        await tx.lesson.upsert({
          where: { moduleId_slug: { moduleId: mod.id, slug: l.slug } },
          create: { moduleId: mod.id, slug: l.slug, ...lessonData },
          update: lessonData,
        });
        count('lessons');
      }
      if (mode === 'upsert') {
        const staleLessons = await tx.lesson.findMany({
          where: { moduleId: mod.id, slug: { notIn: m.lessons.map((l) => l.slug) } },
          select: { id: true, slug: true, _count: { select: { progress: true } } },
        });
        for (const s of staleLessons) {
          if (s._count.progress > 0) warnings.push(`${file}: lesson "${s.slug}" was removed but has learner progress — kept`);
          else await tx.lesson.delete({ where: { id: s.id } });
        }
        await tx.checkpointQuestion.deleteMany({ where: { moduleId: mod.id } });
      }

      if (m.checkpoint.length) {
        await tx.checkpointQuestion.createMany({
          data: m.checkpoint.map((c, ord) => ({
            moduleId: mod.id,
            ord,
            kind: c.kind,
            promptMd: c.prompt_md,
            choices: c.kind === 'mcq' ? json(c.choices) : Prisma.DbNull,
            answer: json(c.answer),
            explanationMd: c.explanation_md,
          })),
        });
        count('checkpoint questions', m.checkpoint.length);
      }
    }
    if (mode === 'insert-missing') continue;

    const staleModules = await tx.learnModule.findMany({
      where: { trackId: track.id, slug: { notIn: t.modules.map((m) => m.slug) } },
      select: {
        id: true,
        slug: true,
        _count: { select: { checkpointAttempts: true } },
        lessons: { select: { _count: { select: { progress: true } } } },
      },
    });
    for (const s of staleModules) {
      const touched = s._count.checkpointAttempts + s.lessons.reduce((n, l) => n + l._count.progress, 0);
      if (touched > 0) warnings.push(`${file}: module "${s.slug}" was removed but has learner progress — kept`);
      else await tx.learnModule.delete({ where: { id: s.id } });
    }
  }
}

// ─── library ─────────────────────────────────────────────────────────────

async function writeLibrary({ tx, seed, mode, warnings, count, keep }: Ctx): Promise<void> {
  const existing =
    mode === 'insert-missing'
      ? await existingBySlug(
          (slugs) => tx.libraryArea.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }),
          seed.areas.map((a) => a.data.slug)
        )
      : new Map<string, string>();
  for (const { file, data: a } of seed.areas) {
    if (existing.has(a.slug)) {
      keep('library areas');
      continue;
    }
    const areaData = { title: a.title, summary: a.summary, icon: a.icon, ord: a.ord };
    // insert-missing reaches here only for a new area: its chapters are new too.
    const area = await tx.libraryArea.upsert({ where: { slug: a.slug }, create: { slug: a.slug, ...areaData }, update: areaData });
    count('library areas');

    for (const [ci, c] of a.chapters.entries()) {
      const chapter = await tx.libraryChapter.upsert({
        where: { areaId_slug: { areaId: area.id, slug: c.slug } },
        create: { areaId: area.id, slug: c.slug, title: c.title, ord: ci },
        update: { title: c.title, ord: ci },
      });
      count('library chapters');
      for (const [xi, x] of c.articles.entries()) {
        const data = {
          chapterId: chapter.id,
          title: x.title,
          summary: x.summary,
          difficulty: x.difficulty,
          readingMinutes: x.reading_minutes,
          ideaMd: x.idea_md,
          formula: x.formula,
          codeCpp: x.code_cpp,
          vizId: x.viz_id,
          applicationsMd: x.applications_md,
          pitfallMd: x.pitfall_md,
          practiceQuestionSlugs: x.practice_question_slugs,
          status: x.status,
          ord: xi,
        };
        if (mode === 'insert-missing') {
          // Article slugs are global: one that exists (in another area) stays where it is.
          if (await tx.libraryArticle.findUnique({ where: { slug: x.slug }, select: { id: true } })) {
            warnings.push(`${file}: article "${x.slug}" already exists in another chapter — left as it is`);
            keep('library articles');
            continue;
          }
          await tx.libraryArticle.create({ data: { slug: x.slug, ...data } });
        } else {
          await tx.libraryArticle.upsert({ where: { slug: x.slug }, create: { slug: x.slug, ...data }, update: data });
        }
        count('library articles');
      }
      if (mode === 'insert-missing') continue;
      const staleArticles = await tx.libraryArticle.findMany({
        where: { chapterId: chapter.id, slug: { notIn: c.articles.map((x) => x.slug) } },
        select: { id: true, slug: true, _count: { select: { progress: true } } },
      });
      for (const s of staleArticles) {
        if (s._count.progress > 0) warnings.push(`${file}: article "${s.slug}" was removed but has readers — kept`);
        else await tx.libraryArticle.delete({ where: { id: s.id } });
      }
    }
    if (mode === 'insert-missing') continue;

    const staleChapters = await tx.libraryChapter.findMany({
      where: { areaId: area.id, slug: { notIn: a.chapters.map((c) => c.slug) } },
      select: { id: true, slug: true },
    });
    for (const s of staleChapters) {
      await tx.libraryArticle.deleteMany({ where: { chapterId: s.id, progress: { none: {} } } });
      const left = await tx.libraryArticle.count({ where: { chapterId: s.id } });
      if (left > 0) warnings.push(`${file}: chapter "${s.slug}" was removed but its articles have readers — kept`);
      else await tx.libraryChapter.delete({ where: { id: s.id } });
    }
  }
}
