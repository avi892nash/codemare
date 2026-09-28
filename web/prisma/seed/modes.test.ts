/**
 * Seed modes (mode.ts): `upsert` makes the database match the files;
 * `insert-missing` only creates rows whose natural key is new and never
 * touches an existing row or anything under it — so what staff edited in
 * Directus survives a production seed.
 */
import { describe, expect, it } from 'vitest';
import { prisma, resetDatabase, setupTestDatabase } from '../../lib/server/test/db';
import { loadSeedDir, SeedError } from './load';
import { dirFrom, seedModeFrom } from './mode';
import { FIXTURES_DIR, runSeed } from './run';
import type { SeedBundle } from './types';
import { validateSeed } from './validate';
import { writeSeed } from './write';

setupTestDatabase();

const fixtures = (): SeedBundle => structuredClone(loadSeedDir(FIXTURES_DIR));

/** Every row of every content.* table as JSON, by table (each has a single-column `id`). */
async function contentRows(): Promise<Record<string, unknown[]>> {
  const tables = await prisma.$queryRaw<{ t: string }[]>`
    SELECT tablename AS t FROM pg_tables WHERE schemaname = 'content' ORDER BY 1`;
  const out: Record<string, unknown[]> = {};
  for (const { t } of tables) {
    const rows = await prisma.$queryRawUnsafe<{ r: unknown }[]>(`SELECT to_jsonb(x) AS r FROM content."${t}" x ORDER BY x.id`);
    out[t] = rows.map((row) => row.r);
  }
  return out;
}

/** Drop ids, foreign keys and timestamps (they differ between databases and re-creations). */
function portable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(portable);
  if (v === null || typeof v !== 'object' || v instanceof Date) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => k !== 'id' && !k.endsWith('Id') && k !== 'createdAt' && k !== 'updatedAt')
      .map(([k, x]) => [k, portable(x)])
  );
}

/** All seeded content with relations named by slug: comparable across databases and runs. */
async function content() {
  const slugOrder = { orderBy: { slug: 'asc' as const } };
  const slugOf = { select: { slug: true } };
  const [tiers, topics, questions, components, gates, badges, tracks, areas] = await Promise.all([
    prisma.tier.findMany(slugOrder),
    prisma.topic.findMany({
      ...slugOrder,
      include: {
        tier: slugOf,
        recipes: {
          orderBy: { ord: 'asc' },
          include: { items: { orderBy: [{ tokenTopic: { slug: 'asc' } }, { quantity: 'asc' }], include: { tokenTopic: slugOf } } },
        },
      },
    }),
    prisma.question.findMany({
      ...slugOrder,
      include: {
        topics: { orderBy: { topic: { slug: 'asc' } }, include: { topic: slugOf } },
        hints: { orderBy: { level: 'asc' } },
      },
    }),
    prisma.component.findMany({
      ...slugOrder,
      include: {
        deps: { orderBy: { dependsOn: { slug: 'asc' } }, include: { dependsOn: slugOf } },
        buildSteps: { orderBy: { ord: 'asc' }, include: { hints: { orderBy: { level: 'asc' } } } },
      },
    }),
    prisma.gate.findMany({
      orderBy: { tier: { ord: 'asc' } },
      include: { tier: slugOf, questions: { orderBy: [{ ord: 'asc' }, { question: { slug: 'asc' } }], include: { question: slugOf } } },
    }),
    prisma.badge.findMany(slugOrder),
    prisma.track.findMany({
      ...slugOrder,
      include: {
        modules: {
          orderBy: { ord: 'asc' },
          include: { lessons: { orderBy: { ord: 'asc' } }, checkpointQuestions: { orderBy: { ord: 'asc' } } },
        },
      },
    }),
    prisma.libraryArea.findMany({
      ...slugOrder,
      include: { chapters: { orderBy: { ord: 'asc' }, include: { articles: { orderBy: { ord: 'asc' } } } } },
    }),
  ]);
  return portable({ tiers, topics, questions, components, gates, badges, tracks, areas });
}

/** What staff might change in Directus after the first seed — every kind of row and child. */
async function editLikeStaff(): Promise<void> {
  const twoSum = await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' } });
  const arrays = await prisma.topic.findUniqueOrThrow({ where: { slug: 'arrays' } });
  const pointers = await prisma.topic.findUniqueOrThrow({ where: { slug: 'two-pointers' } });

  await prisma.tier.update({ where: { slug: 'structures' }, data: { title: 'Structures (staff)' } });
  await prisma.topic.update({ where: { slug: 'heaps' }, data: { summary: 'Staff summary' } });
  await prisma.question.update({
    where: { id: twoSum.id },
    data: { title: 'Two Sum (staff)', tests: [{ input: [[1, 2], 3], expected: [0, 1], hidden: false }] },
  });
  // question topics: a new weight, and a second topic
  await prisma.questionTopic.update({
    where: { questionId_topicId: { questionId: twoSum.id, topicId: arrays.id } },
    data: { weight: 2.5 },
  });
  await prisma.questionTopic.create({ data: { questionId: twoSum.id, topicId: pointers.id, weight: 0.5 } });
  // hints: the top rung removed, another reworded
  await prisma.hint.delete({ where: { questionId_level: { questionId: twoSum.id, level: 'pseudo' } } });
  await prisma.hint.update({
    where: { questionId_level: { questionId: twoSum.id, level: 'nudge' } },
    data: { bodyMd: 'Staff nudge', costAmount: 5 },
  });
  // recipes: an item's quantity, a whole recipe removed
  const [fluency, practice] = await prisma.unlockRecipe.findMany({
    where: { topic: { slug: 'heaps' } },
    orderBy: { ord: 'asc' },
    include: { items: true },
  });
  await prisma.recipeItem.update({ where: { id: fluency.items[0].id }, data: { quantity: 5 } });
  await prisma.unlockRecipe.delete({ where: { id: practice.id } });
  // components: the dependency reversed (swap-at has none in the files), build steps retitled
  const siftDown = await prisma.component.findUniqueOrThrow({ where: { slug: 'sift-down' } });
  const swapAt = await prisma.component.findUniqueOrThrow({ where: { slug: 'swap-at' } });
  await prisma.componentDep.deleteMany({ where: { componentId: siftDown.id } });
  await prisma.componentDep.create({ data: { componentId: swapAt.id, dependsOnId: siftDown.id } });
  await prisma.buildStep.updateMany({ where: { componentId: siftDown.id }, data: { title: 'Staff step' } });
  // gates: the questions reordered
  const gate = await prisma.gate.findFirstOrThrow({ include: { questions: { orderBy: { ord: 'asc' } } } });
  const [first, second] = gate.questions;
  await prisma.gateQuestion.update({ where: { id: first.id }, data: { ord: 1 } });
  await prisma.gateQuestion.update({ where: { id: second.id }, data: { ord: 0 } });
  // badges, learn, library
  await prisma.badge.update({ where: { slug: 'first-accept' }, data: { name: 'Staff badge' } });
  await prisma.lesson.updateMany({ where: { slug: 'one-pass' }, data: { bodyMd: 'Staff lesson body' } });
  await prisma.checkpointQuestion.deleteMany({ where: { ord: 1 } });
  await prisma.libraryArticle.update({ where: { slug: 'lower-bound' }, data: { title: 'Staff article' } });
}

describe('seed mode selection', () => {
  it('defaults to upsert; --mode beats SEED_MODE', () => {
    expect(seedModeFrom([], {})).toBe('upsert');
    expect(seedModeFrom([], { SEED_MODE: '' })).toBe('upsert');
    expect(seedModeFrom([], { SEED_MODE: 'insert-missing' })).toBe('insert-missing');
    expect(seedModeFrom(['--mode', 'insert-missing'], {})).toBe('insert-missing');
    expect(seedModeFrom(['--dir', 'x', '--mode=upsert'], { SEED_MODE: 'insert-missing' })).toBe('upsert');
    expect(dirFrom(['--mode', 'upsert', '--dir', 'some/dir'])).toBe('some/dir');
    expect(dirFrom(['--dir=other'])).toBe('other');
    expect(dirFrom([])).toBeUndefined();
  });

  it('rejects an unknown mode', () => {
    expect(() => seedModeFrom(['--mode', 'merge'], {})).toThrow(SeedError);
    expect(() => seedModeFrom([], { SEED_MODE: 'overwrite' })).toThrow(/SEED_MODE: "overwrite" is not a seed mode/);
    expect(() => seedModeFrom(['--mode'], {})).toThrow(/--mode: "" is not a seed mode/);
  });
});

describe('insert-missing', () => {
  it('seeds an empty database exactly like upsert (the first deploy)', async () => {
    const inserted = await runSeed({ dir: FIXTURES_DIR, prisma, mode: 'insert-missing' });
    const viaInsert = await content();
    expect(inserted.kept).toEqual({});

    await resetDatabase();
    const upserted = await runSeed({ dir: FIXTURES_DIR, prisma });
    expect(viaInsert).toEqual(await content());
    expect(inserted.counts).toEqual(upserted.counts);
    expect(upserted.mode).toBe('upsert');
  });

  it('leaves edited rows and everything under them exactly as they are', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    await editLikeStaff();
    const before = await contentRows();

    const summary = await runSeed({ dir: FIXTURES_DIR, prisma, mode: 'insert-missing' });
    expect(await contentRows()).toEqual(before); // not one content row changed, ids and timestamps included
    expect(summary.counts).toEqual({});
    expect(summary.kept).toEqual({
      tiers: 2,
      topics: 3,
      questions: 2,
      components: 2,
      gates: 1,
      badges: 2,
      tracks: 1,
      'library areas': 1,
    });

    const twoSum = await prisma.question.findUniqueOrThrow({
      where: { slug: 'two-sum' },
      include: { topics: { include: { topic: true } }, hints: true },
    });
    expect(twoSum.title).toBe('Two Sum (staff)');
    expect(twoSum.topics.map((t) => [t.topic.slug, t.weight]).sort()).toEqual([
      ['arrays', 2.5],
      ['two-pointers', 0.5],
    ]);
    expect(twoSum.hints.map((h) => h.level).sort()).toEqual(['concept', 'nudge']);
    const deps = await prisma.componentDep.findMany({ include: { component: true, dependsOn: true } });
    expect(deps.map((d) => [d.component.slug, d.dependsOn.slug])).toEqual([['swap-at', 'sift-down']]);
  });

  it('creates a new slug with what it owns, pointing at the rows that exist', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    await editLikeStaff();
    const before = await contentRows();

    const seed = fixtures();
    const twoSum = seed.questions.find((q) => q.data.slug === 'two-sum')!.data;
    seed.questions.push({
      file: 'questions/two-sum-sorted.json',
      data: {
        ...structuredClone(twoSum),
        slug: 'two-sum-sorted',
        title: 'Two Sum (sorted)',
        topics: [
          { slug: 'two-pointers', weight: 1 },
          { slug: 'arrays', weight: 0.25 },
        ],
      },
    });
    seed.loop.data.components.push({
      ...structuredClone(seed.loop.data.components[1]),
      slug: 'heap-push',
      title: 'Heap push',
      depends_on: ['sift-down', 'swap-at'],
    });
    seed.badges!.data.push({ ...structuredClone(seed.badges!.data[0]), slug: 'second-accept', name: 'Again' });
    expect(validateSeed(seed).errors).toEqual([]);

    const summary = await writeSeed(prisma, seed, { mode: 'insert-missing' });
    expect(summary.counts).toEqual({ questions: 1, hints: 5, components: 1, 'build steps': 1, badges: 1 });
    expect(summary.warnings).toEqual([]);

    // Everything that existed is untouched…
    const after = await contentRows();
    for (const [table, rows] of Object.entries(before)) expect(after[table]).toEqual(expect.arrayContaining(rows));
    expect(await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' } })).toMatchObject({ title: 'Two Sum (staff)' });
    expect(await prisma.componentDep.count({ where: { component: { slug: 'sift-down' } } })).toBe(0);

    // …and the new rows came with their children, linked to the existing rows.
    const added = await prisma.question.findUniqueOrThrow({
      where: { slug: 'two-sum-sorted' },
      include: { topics: { include: { topic: true } }, hints: true },
    });
    expect(added.topics.map((t) => [t.topic.slug, t.weight]).sort()).toEqual([
      ['arrays', 0.25],
      ['two-pointers', 1],
    ]);
    expect(added.hints).toHaveLength(3);
    const heapPush = await prisma.component.findUniqueOrThrow({
      where: { slug: 'heap-push' },
      include: { deps: { include: { dependsOn: true } }, buildSteps: { include: { hints: true } } },
    });
    expect(heapPush.deps.map((d) => d.dependsOn.slug).sort()).toEqual(['sift-down', 'swap-at']);
    expect(heapPush.buildSteps.map((s) => [s.title, s.hints.length])).toEqual([['Build siftDown', 2]]);
    expect(await prisma.badge.findUnique({ where: { slug: 'second-accept' } })).not.toBeNull();
  });

  it('refuses a new tier whose ord an existing tier holds, and writes nothing', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    await prisma.tier.create({ data: { slug: 'advanced', ord: 2, title: 'Advanced', summary: '' } }); // made in Directus
    const before = await contentRows();

    const seed = fixtures();
    seed.loop.data.tiers.push({ ord: 2, slug: 'graphs', title: 'Graphs', summary: '' });
    seed.loop.data.gates.push({
      tier: 'graphs',
      title: 'Graphs gate',
      summary: '',
      pass_threshold: 1,
      cooldown_hours: 12,
      time_limit_minutes: 60,
      questions: ['two-sum'],
    });
    seed.badges!.data.push({ ...structuredClone(seed.badges!.data[0]), slug: 'unwritten', name: 'Never written' });
    expect(validateSeed(seed).errors).toEqual([]);

    await expect(writeSeed(prisma, seed, { mode: 'insert-missing' })).rejects.toThrow(
      /tier "graphs" needs ord 2, which tier "advanced" holds/
    );
    expect(await contentRows()).toEqual(before);
  });

  it('skips a new area’s article whose slug already exists elsewhere, with a warning', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    const existing = await prisma.libraryArticle.findUniqueOrThrow({ where: { slug: 'lower-bound' } });

    const seed = fixtures();
    const area = structuredClone(seed.areas[0]);
    area.file = 'library/ordering.json';
    area.data.slug = 'ordering';
    area.data.ord = 1;
    area.data.chapters[0].articles.push({ ...structuredClone(area.data.chapters[0].articles[0]), slug: 'upper-bound' });
    seed.areas = [area]; // the release moved lower-bound to a new area; staff still have it in "searching"

    const summary = await writeSeed(prisma, seed, { mode: 'insert-missing' });
    expect(summary.warnings).toEqual([expect.stringContaining('article "lower-bound" already exists in another chapter')]);
    expect(summary.counts).toMatchObject({ 'library areas': 1, 'library chapters': 1, 'library articles': 1 });
    expect(await prisma.libraryArticle.findUniqueOrThrow({ where: { slug: 'lower-bound' } })).toEqual(existing);
    expect(
      await prisma.libraryArticle.findUniqueOrThrow({ where: { slug: 'upper-bound' }, include: { chapter: { include: { area: true } } } })
    ).toMatchObject({ chapter: { area: { slug: 'ordering' } } });
  });
});

describe('upsert', () => {
  it('still resets edited rows to the files, and join rows that stay keep their ids', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    const seeded = await content();
    const joinIds = async () => ({
      questionTopics: await prisma.questionTopic.findMany({ select: { id: true, questionId: true, topicId: true } }),
      gateQuestions: await prisma.gateQuestion.findMany({ select: { id: true, gateId: true, questionId: true } }),
    });
    const seededIds = await joinIds();

    await editLikeStaff();
    expect(await content()).not.toEqual(seeded);

    const summary = await runSeed({ dir: FIXTURES_DIR, prisma });
    expect(summary.mode).toBe('upsert');
    expect(await content()).toEqual(seeded); // incl. swap-at's staff dependency removed (it has none in the files)
    const after = await joinIds();
    expect(after.questionTopics).toEqual(expect.arrayContaining(seededIds.questionTopics));
    expect(after.questionTopics).toHaveLength(seededIds.questionTopics.length); // the staff-added topic is gone
    expect(after.gateQuestions).toEqual(expect.arrayContaining(seededIds.gateQuestions));
  });
});
