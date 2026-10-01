import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma, setupTestDatabase } from '../../lib/server/test/db';
import { loadSeedDir, SeedError } from './load';
import { FIXTURES_DIR, runSeed } from './run';
import type { SeedBundle } from './types';
import { validateSeed } from './validate';
import { writeSeed } from './write';

setupTestDatabase();

const fixtures = (): SeedBundle => structuredClone(loadSeedDir(FIXTURES_DIR));
const errorsOf = (seed: SeedBundle) => validateSeed(seed).errors;

async function snapshot() {
  const [tiers, topics, questions, recipes, items, hints, gateQs, badges, lessons, checkpoints, articles] =
    await Promise.all([
      prisma.tier.findMany({ orderBy: { slug: 'asc' } }),
      prisma.topic.findMany({ orderBy: { slug: 'asc' } }),
      prisma.question
        .findMany({ orderBy: { slug: 'asc' } })
        .then((rows) => rows.map(({ createdAt: _c, updatedAt: _u, ...q }) => q)),
      prisma.unlockRecipe.findMany({ orderBy: { id: 'asc' } }),
      prisma.recipeItem.count(),
      prisma.hint.findMany({ orderBy: { id: 'asc' } }),
      prisma.gateQuestion.findMany({ orderBy: { ord: 'asc' } }),
      prisma.badge.findMany({ orderBy: { slug: 'asc' } }),
      prisma.lesson.findMany({ orderBy: { slug: 'asc' } }),
      prisma.checkpointQuestion.count(),
      prisma.libraryArticle.findMany({ orderBy: { slug: 'asc' } }),
    ]);
  return { tiers, topics, questions, recipes, items, hints, gateQs, badges, lessons, checkpoints, articles };
}

describe('fixtures', () => {
  it('validate cleanly', () => {
    expect(validateSeed(fixtures())).toEqual({ errors: [], warnings: [] });
  });

  it('seed idempotently: a second run changes nothing (ids included)', async () => {
    const first = await runSeed({ dir: FIXTURES_DIR, prisma });
    expect(first.counts).toMatchObject({ tiers: 2, topics: 3, questions: 2, gates: 1, badges: 2, tracks: 1 });
    const before = await snapshot();
    expect(before.questions.map((q) => q.status)).toEqual(['published', 'published']);
    expect(before.hints).toHaveLength(5);

    const second = await runSeed({ dir: FIXTURES_DIR, prisma });
    expect(second.counts).toEqual(first.counts);
    expect(await snapshot()).toEqual(before);
  });

  it('updates content in place and prunes removed children', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    const q = await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' } });

    const seed = fixtures();
    const twoSum = seed.questions.find((x) => x.data.slug === 'two-sum')!.data;
    twoSum.title = 'Two Sum (revised)';
    twoSum.hints = twoSum.hints.slice(0, 1); // drop concept + pseudo
    seed.loop.data.recipes = seed.loop.data.recipes.slice(0, 1); // drop "Pointer practice"
    await writeSeed(prisma, seed);

    const after = await prisma.question.findUniqueOrThrow({ where: { slug: 'two-sum' }, include: { hints: true } });
    expect(after.id).toBe(q.id);
    expect(after.title).toBe('Two Sum (revised)');
    expect(after.hints.map((h) => h.level)).toEqual(['nudge']);
    expect(await prisma.unlockRecipe.count()).toBe(1);
  });

  it('keeps removed hints that users already revealed, with a warning', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    const user = await prisma.user.create({ data: { email: 'u@test.dev', handle: 'u_1' } });
    const concept = await prisma.hint.findFirstOrThrow({ where: { question: { slug: 'two-sum' }, level: 'concept' } });
    await prisma.hintUse.create({
      data: { userId: user.id, hintId: concept.id, questionId: concept.questionId, costKind: 'score', costAmount: 10 },
    });

    const seed = fixtures();
    seed.questions.find((x) => x.data.slug === 'two-sum')!.data.hints = [];
    const { warnings } = await writeSeed(prisma, seed);
    expect(warnings).toEqual([expect.stringContaining('hint "concept" was removed but users revealed it')]);
    expect(await prisma.hint.findUnique({ where: { id: concept.id } })).not.toBeNull();
  });

  it('survives tiers swapping ords (unique ord)', async () => {
    await runSeed({ dir: FIXTURES_DIR, prisma });
    const seed = fixtures();
    const [free, next] = seed.loop.data.tiers;
    [free.ord, next.ord] = [next.ord, free.ord];
    // keep the data valid: the gate moves to the new non-free tier
    seed.loop.data.gates[0].tier = free.slug;
    seed.loop.data.recipes = [];
    await writeSeed(prisma, seed);
    const tiers = await prisma.tier.findMany({ orderBy: { ord: 'asc' } });
    expect(tiers.map((t) => t.slug)).toEqual(['structures', 'foundations']);
  });
});

describe('validation errors', () => {
  it('rejects an unknown topic slug', () => {
    const seed = fixtures();
    seed.questions[0].data.topics.push({ slug: 'no-such-topic', weight: 1 });
    expect(errorsOf(seed)).toEqual([expect.stringMatching(/topics\[\d\]: unknown topic "no-such-topic"/)]);
  });

  it('rejects hint ladders with gaps or duplicates', () => {
    const seed = fixtures();
    const q = seed.questions.find((x) => x.data.slug === 'two-sum')!.data;
    q.hints = q.hints.filter((h) => h.level !== 'concept'); // nudge, pseudo
    expect(errorsOf(seed)).toEqual([expect.stringContaining('missing concept')]);

    const dup = fixtures();
    const d = dup.questions.find((x) => x.data.slug === 'two-sum')!.data;
    d.hints.push({ ...d.hints[0] });
    expect(errorsOf(dup)).toEqual([expect.stringContaining('duplicate hint level "nudge"')]);
  });

  it('rejects a gate question missing from questions/', () => {
    const seed = fixtures();
    seed.loop.data.gates[0].questions.push('ghost-question');
    expect(errorsOf(seed)).toEqual([expect.stringContaining('gate question "ghost-question" is missing from questions/')]);
  });

  it('rejects a tier without a gate, a topic without a recipe, and recipe deadlocks', () => {
    const noGate = fixtures();
    noGate.loop.data.gates = [];
    expect(errorsOf(noGate)).toEqual([expect.stringContaining('tier "structures" (ord 1) has no gate')]);

    const noRecipe = fixtures();
    noRecipe.loop.data.recipes = [];
    expect(errorsOf(noRecipe)).toEqual([expect.stringContaining('topic "heaps" (tier "structures") has no unlock recipe')]);

    const deadlock = fixtures();
    deadlock.loop.data.recipes = [{ topic: 'heaps', title: 'self', items: [{ topic: 'heaps', quantity: 1, min_difficulty: 'Easy' }] }];
    expect(errorsOf(deadlock)).toEqual([expect.stringContaining('topic "heaps" can never be unlocked')]);
  });

  it('rejects recipes the content can never pay for', () => {
    // Fixtures pay out 2 arrays tokens in total (one from each question), none Hard.
    const greedy = fixtures();
    greedy.loop.data.recipes = [
      { topic: 'heaps', title: 'a lot', items: [{ topic: 'arrays', quantity: 3, min_difficulty: 'Easy' }] },
      { topic: 'heaps', title: 'too hard', items: [{ topic: 'arrays', quantity: 1, min_difficulty: 'Hard' }] },
    ];
    expect(errorsOf(greedy)).toEqual([expect.stringContaining('no recipe fits in the tokens all published questions pay out')]);

    const ok = fixtures();
    ok.loop.data.recipes = [{ topic: 'heaps', title: 'just enough', items: [{ topic: 'arrays', quantity: 2, min_difficulty: 'Easy' }] }];
    expect(validateSeed(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects test inputs that do not match the signature and Go stubs with a package clause', () => {
    const seed = fixtures();
    const q = seed.questions[0].data;
    q.tests[0].input = [[1, 2]];
    q.starter_code.go = 'package main\n\n' + q.starter_code.go;
    expect(errorsOf(seed)).toEqual([
      expect.stringContaining('tests[0].input has 1 argument(s); the signature takes 2'),
      expect.stringContaining('Go stubs must not have a package clause'),
    ]);
  });

  it('rejects dangling learn and library references and per-track lesson slug clashes', () => {
    const seed = fixtures();
    const lessons = seed.tracks[0].data.modules[0].lessons;
    lessons[0].related_question_slugs.push('nope');
    lessons[1].slug = lessons[0].slug;
    seed.areas[0].data.chapters[0].articles[0].practice_question_slugs = ['missing-q'];
    expect(errorsOf(seed)).toEqual([
      expect.stringContaining('duplicate lesson slug'),
      expect.stringContaining('related question "nope"'),
      expect.stringContaining('practice question "missing-q"'),
    ]);
  });

  it('refuses to write anything when invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemare-seed-'));
    cleanup.push(dir);
    const seed = fixtures();
    seed.loop.data.gates[0].questions.push('ghost');
    writeFileSync(join(dir, 'loop.json'), JSON.stringify(seed.loop.data));
    mkdirSync(join(dir, 'questions'));
    for (const q of seed.questions) writeFileSync(join(dir, q.file), JSON.stringify(q.data));
    await expect(runSeed({ dir, prisma })).rejects.toBeInstanceOf(SeedError);
    expect(await prisma.tier.count()).toBe(0);
  });
});

describe('loaders', () => {
  it('collect every schema problem across files at once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemare-seed-'));
    cleanup.push(dir);
    writeFileSync(join(dir, 'loop.json'), JSON.stringify({ tiers: [], topics: [], surprise: true }));
    mkdirSync(join(dir, 'questions'));
    writeFileSync(join(dir, 'questions', 'wrong-name.json'), JSON.stringify({ ...fixtures().questions[0].data }));
    writeFileSync(join(dir, 'badges.json'), JSON.stringify([{ slug: 'x', name: 'x', description: '', icon: 'not-an-icon', rarity: 'common', criteria: { kind: 'solves' } }]));

    let err: SeedError | undefined;
    try {
      loadSeedDir(dir);
    } catch (e) {
      err = e as SeedError;
    }
    expect(err).toBeInstanceOf(SeedError);
    const text = err!.problems.join('\n');
    expect(text).toMatch(/loop\.json: Unrecognized key\(s\) in object: 'surprise'/);
    expect(text).toMatch(/loop\.json: tiers: Array must contain at least 1/);
    expect(text).toMatch(/questions\/wrong-name\.json: slug "[a-z-]+" must match the file name "wrong-name"/);
    expect(text).toMatch(/badges\.json: 0\.icon/);
    expect(text).toMatch(/badges\.json: 0\.criteria\.n: Required/);
  });

  it('require loop.json and at least one question', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codemare-seed-'));
    cleanup.push(dir);
    expect(() => loadSeedDir(dir)).toThrow(/loop\.json: missing[\s\S]*no question files/);
  });
});

const cleanup: string[] = [];
afterAll(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));
