/**
 * Write a validated seed bundle to the content schema — idempotently, in one
 * transaction. Top-level entities upsert by slug (ids survive re-seeds, so
 * user progress keeps pointing at the same rows); owned sets (question
 * topics, recipe items, deps, gate questions, checkpoint questions) are
 * replaced; ordered children (recipes, build steps, modules, lessons,
 * chapters, articles, hints) upsert by their natural key and stale ones are
 * deleted — unless users already touched them, in which case they are kept
 * and reported as warnings.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { SeedError } from './load';
import type { Hint, SeedBundle } from './types';

type Tx = Prisma.TransactionClient;
type Ids = Map<string, string>;
type Count = (kind: string, n?: number) => void;

export interface SeedSummary {
  counts: Record<string, number>;
  warnings: string[];
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function writeSeed(prisma: PrismaClient, seed: SeedBundle): Promise<SeedSummary> {
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const count: Count = (k, n = 1) => {
    counts[k] = (counts[k] ?? 0) + n;
  };

  await prisma.$transaction(
    async (tx) => {
      const tierIds = await writeTiers(tx, seed);
      count('tiers', tierIds.size);
      const topicIds = await writeTopics(tx, seed, tierIds);
      count('topics', topicIds.size);
      const questionIds = await writeQuestions(tx, seed, topicIds, warnings, count);
      count('questions', questionIds.size);
      count('recipes', await writeRecipes(tx, seed, topicIds));
      count('components', await writeComponents(tx, seed, topicIds, warnings, count));
      count('gates', await writeGates(tx, seed, tierIds, questionIds));
      count('badges', await writeBadges(tx, seed));
      await writeLearn(tx, seed, tierIds, topicIds, warnings, count);
      await writeLibrary(tx, seed, warnings, count);
    },
    { maxWait: 30_000, timeout: 300_000 }
  );
  return { counts, warnings };
}

// ─── loop ────────────────────────────────────────────────────────────────

async function writeTiers(tx: Tx, seed: SeedBundle): Promise<Ids> {
  const tiers = seed.loop.data.tiers;
  const existing = await tx.tier.findMany({ select: { id: true, slug: true, ord: true } });
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
  const ids: Ids = new Map();
  for (const t of tiers) {
    const data = { ord: t.ord, title: t.title, summary: t.summary };
    const row = await tx.tier.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...data }, update: data });
    ids.set(t.slug, row.id);
  }
  return ids;
}

async function writeTopics(tx: Tx, seed: SeedBundle, tierIds: Ids): Promise<Ids> {
  const ids: Ids = new Map();
  const position = new Map<string, number>();
  for (const t of seed.loop.data.topics) {
    const ord = t.ord ?? position.get(t.tier) ?? 0;
    position.set(t.tier, (position.get(t.tier) ?? 0) + 1);
    const data = { tierId: tierIds.get(t.tier)!, title: t.title, summary: t.summary, icon: t.icon, ord };
    const row = await tx.topic.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...data }, update: data });
    ids.set(t.slug, row.id);
  }
  return ids;
}

async function writeRecipes(tx: Tx, seed: SeedBundle, topicIds: Ids): Promise<number> {
  let n = 0;
  for (const topic of seed.loop.data.topics) {
    const topicId = topicIds.get(topic.slug)!;
    const recipes = seed.loop.data.recipes.filter((r) => r.topic === topic.slug);
    const existing = await tx.unlockRecipe.findMany({ where: { topicId }, orderBy: { ord: 'asc' } });
    for (const [ord, r] of recipes.entries()) {
      const match = existing.find((e) => e.ord === ord);
      const { id } = match
        ? await tx.unlockRecipe.update({ where: { id: match.id }, data: { title: r.title } })
        : await tx.unlockRecipe.create({ data: { topicId, title: r.title, ord } });
      await tx.recipeItem.deleteMany({ where: { recipeId: id } });
      await tx.recipeItem.createMany({
        data: r.items.map((it) => ({
          recipeId: id,
          tokenTopicId: topicIds.get(it.topic)!,
          quantity: it.quantity,
          minDifficulty: it.min_difficulty,
        })),
      });
      n++;
    }
    // unlocks.via_recipe_id is ON DELETE SET NULL: dropping a recipe keeps unlocks.
    await tx.unlockRecipe.deleteMany({ where: { topicId, ord: { gte: recipes.length } } });
  }
  return n;
}

async function syncHints(
  tx: Tx,
  target: { questionId: string } | { buildStepId: string },
  hints: readonly Hint[],
  where: string,
  warnings: string[],
  count: Count
): Promise<void> {
  count('hints', hints.length);
  for (const h of hints) {
    const data = { bodyMd: h.body_md, costKind: h.cost_kind, costAmount: h.cost_amount };
    await tx.hint.upsert({
      where:
        'questionId' in target
          ? { questionId_level: { questionId: target.questionId, level: h.level } }
          : { buildStepId_level: { buildStepId: target.buildStepId, level: h.level } },
      create: { ...target, level: h.level, ...data },
      update: data,
    });
  }
  const stale = await tx.hint.findMany({
    where: { ...target, level: { notIn: hints.map((h) => h.level) } },
    select: { id: true, level: true, _count: { select: { uses: true } } },
  });
  for (const s of stale) {
    if (s._count.uses > 0) warnings.push(`${where}: hint "${s.level}" was removed but users revealed it — kept`);
    else await tx.hint.delete({ where: { id: s.id } });
  }
}

async function writeComponents(tx: Tx, seed: SeedBundle, topicIds: Ids, warnings: string[], count: Count): Promise<number> {
  const ids: Ids = new Map();
  for (const [i, c] of seed.loop.data.components.entries()) {
    const data = {
      topicId: topicIds.get(c.topic)!,
      title: c.title,
      summaryMd: c.summary_md,
      functionName: c.function_name,
      signature: json(c.signature),
      languages: c.languages,
      ord: c.ord ?? i,
    };
    const row = await tx.component.upsert({ where: { slug: c.slug }, create: { slug: c.slug, ...data }, update: data });
    ids.set(c.slug, row.id);
  }

  for (const c of seed.loop.data.components) {
    const componentId = ids.get(c.slug)!;
    await tx.componentDep.deleteMany({ where: { componentId } });
    if (c.depends_on.length) {
      await tx.componentDep.createMany({ data: c.depends_on.map((d) => ({ componentId, dependsOnId: ids.get(d)! })) });
    }

    const existing = await tx.buildStep.findMany({ where: { componentId }, orderBy: { ord: 'asc' } });
    for (const [ord, s] of c.build_steps.entries()) {
      const data = { kind: s.kind, title: s.title, promptMd: s.prompt_md, difficulty: s.difficulty, payload: json(s.payload) };
      const match = existing.find((e) => e.ord === ord);
      const { id } = match
        ? await tx.buildStep.update({ where: { id: match.id }, data })
        : await tx.buildStep.create({ data: { componentId, ord, ...data } });
      await syncHints(tx, { buildStepId: id }, s.hints, `components "${c.slug}" build_steps[${ord}]`, warnings, count);
      count('build steps');
    }
    const stale = await tx.buildStep.findMany({
      where: { componentId, ord: { gte: c.build_steps.length } },
      select: { id: true, ord: true, _count: { select: { submissions: true, stepProgress: true, hintUses: true } } },
    });
    for (const s of stale) {
      if (s._count.submissions + s._count.stepProgress + s._count.hintUses > 0) {
        warnings.push(`components "${c.slug}": build step ${s.ord} was removed but has user progress — kept`);
      } else {
        await tx.buildStep.delete({ where: { id: s.id } });
      }
    }
  }
  return ids.size;
}

async function writeGates(tx: Tx, seed: SeedBundle, tierIds: Ids, questionIds: Ids): Promise<number> {
  for (const g of seed.loop.data.gates) {
    const tierId = tierIds.get(g.tier)!;
    const data = {
      title: g.title,
      summary: g.summary,
      passThreshold: g.pass_threshold,
      cooldownHours: g.cooldown_hours,
      timeLimitMinutes: g.time_limit_minutes,
    };
    const gate = await tx.gate.upsert({ where: { tierId }, create: { tierId, ...data }, update: data });
    await tx.gateQuestion.deleteMany({ where: { gateId: gate.id } });
    await tx.gateQuestion.createMany({
      data: g.questions.map((slug, ord) => ({ gateId: gate.id, questionId: questionIds.get(slug)!, ord })),
    });
  }
  return seed.loop.data.gates.length;
}

// ─── questions, badges ───────────────────────────────────────────────────

async function writeQuestions(tx: Tx, seed: SeedBundle, topicIds: Ids, warnings: string[], count: Count): Promise<Ids> {
  const ids: Ids = new Map();
  for (const { file, data: q } of seed.questions) {
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
    const row = await tx.question.upsert({ where: { slug: q.slug }, create: { slug: q.slug, ...data }, update: data });
    ids.set(q.slug, row.id);
    await tx.questionTopic.deleteMany({ where: { questionId: row.id } });
    await tx.questionTopic.createMany({
      data: q.topics.map((t) => ({ questionId: row.id, topicId: topicIds.get(t.slug)!, weight: t.weight })),
    });
    await syncHints(tx, { questionId: row.id }, q.hints, file, warnings, count);
  }
  return ids;
}

async function writeBadges(tx: Tx, seed: SeedBundle): Promise<number> {
  const badges = seed.badges?.data ?? [];
  for (const [i, b] of badges.entries()) {
    const data = {
      name: b.name,
      description: b.description,
      icon: b.icon,
      rarity: b.rarity,
      criteria: json(b.criteria),
      ord: b.ord ?? i,
    };
    await tx.badge.upsert({ where: { slug: b.slug }, create: { slug: b.slug, ...data }, update: data });
  }
  return badges.length;
}

// ─── learn ───────────────────────────────────────────────────────────────

async function writeLearn(
  tx: Tx,
  seed: SeedBundle,
  tierIds: Ids,
  topicIds: Ids,
  warnings: string[],
  count: Count
): Promise<void> {
  for (const { file, data: t } of seed.tracks) {
    const trackData = {
      title: t.title,
      summary: t.summary,
      level: t.level,
      tierId: t.tier ? tierIds.get(t.tier)! : null,
      estHours: t.est_hours,
      ord: t.ord,
    };
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
      const staleLessons = await tx.lesson.findMany({
        where: { moduleId: mod.id, slug: { notIn: m.lessons.map((l) => l.slug) } },
        select: { id: true, slug: true, _count: { select: { progress: true } } },
      });
      for (const s of staleLessons) {
        if (s._count.progress > 0) warnings.push(`${file}: lesson "${s.slug}" was removed but has learner progress — kept`);
        else await tx.lesson.delete({ where: { id: s.id } });
      }

      await tx.checkpointQuestion.deleteMany({ where: { moduleId: mod.id } });
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

async function writeLibrary(tx: Tx, seed: SeedBundle, warnings: string[], count: Count): Promise<void> {
  for (const { file, data: a } of seed.areas) {
    const areaData = { title: a.title, summary: a.summary, icon: a.icon, ord: a.ord };
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
        await tx.libraryArticle.upsert({ where: { slug: x.slug }, create: { slug: x.slug, ...data }, update: data });
        count('library articles');
      }
      const staleArticles = await tx.libraryArticle.findMany({
        where: { chapterId: chapter.id, slug: { notIn: c.articles.map((x) => x.slug) } },
        select: { id: true, slug: true, _count: { select: { progress: true } } },
      });
      for (const s of staleArticles) {
        if (s._count.progress > 0) warnings.push(`${file}: article "${s.slug}" was removed but has readers — kept`);
        else await tx.libraryArticle.delete({ where: { id: s.id } });
      }
    }

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
