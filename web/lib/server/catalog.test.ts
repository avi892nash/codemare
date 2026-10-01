import { describe, expect, it } from 'vitest';
import { EMPTY_CATALOG_QUERY, type CatalogQuery } from '@/components/Catalog/query';
import type { Difficulty } from '@/lib/types';
import { acceptanceRates, listCatalog, matchesSearch, userQuestionProgress } from './catalog';
import { prisma, setupTestDatabase } from './test/db';
import {
  makeGate,
  makeQuestion,
  makeSubmission,
  makeTier,
  makeTopic,
  makeUser,
  unlockTopicRow,
} from './test/factories';

setupTestDatabase();

async function question(
  slug: string,
  title: string,
  difficulty: Difficulty,
  topics: { topicId: string; weight?: number }[],
  extra: { tags?: string[]; companies?: string[]; status?: 'draft' | 'published' } = {}
) {
  const q = await makeQuestion({ slug, difficulty, topics, status: extra.status });
  return prisma.question.update({
    where: { id: q.id },
    data: { title, tags: extra.tags ?? [], companies: extra.companies ?? [] },
  });
}

/**
 * tier 0: arrays (ord 0), strings (ord 1) — free
 * tier 1: graphs — locked until unlocked
 */
async function world() {
  const tier0 = await makeTier(0);
  const tier1 = await makeTier(1);
  const arrays = await makeTopic(tier0.id, { slug: 'arrays', ord: 0 });
  const strings = await makeTopic(tier0.id, { slug: 'strings', ord: 1 });
  const graphs = await makeTopic(tier1.id, { slug: 'graphs', ord: 0 });
  const twoSum = await question('two-sum', 'Two Sum', 'Easy', [{ topicId: arrays.id }], {
    tags: ['array', 'hash-table'],
    companies: ['Amazon', 'Google'],
  });
  const maxSub = await question('max-sub', 'Maximum Subarray', 'Medium', [{ topicId: arrays.id }], {
    tags: ['array', 'dynamic-programming'],
    companies: ['LinkedIn'],
  });
  const anagram = await question('anagram', 'Valid Anagram', 'Easy', [{ topicId: strings.id }], {
    tags: ['string', 'hash-table'],
    companies: ['amazon'],
  });
  const islands = await question('islands', 'Number of Islands', 'Medium', [{ topicId: graphs.id }], {
    tags: ['graph', 'bfs'],
    companies: ['Google'],
  });
  const ladder = await question(
    'ladder',
    'Word Ladder',
    'Hard',
    [
      { topicId: strings.id, weight: 0.5 },
      { topicId: graphs.id, weight: 1 },
    ],
    { tags: ['graph', 'string'], companies: ['Meta'] }
  );
  await question('draft', 'Secret Draft', 'Easy', [{ topicId: arrays.id }], { status: 'draft', tags: ['array'] });
  return { tier0, tier1, arrays, strings, graphs, twoSum, maxSub, anagram, islands, ladder };
}

const Q = (patch: Partial<CatalogQuery> = {}): CatalogQuery => ({ ...EMPTY_CATALOG_QUERY, ...patch });
const slugs = (r: { rows: { slug: string }[] }) => r.rows.map((x) => x.slug);

describe('listCatalog', () => {
  it('lists published questions only, in curriculum order', async () => {
    await world();
    const user = await makeUser();
    const r = await listCatalog(user.id, Q());
    // tier 0 arrays (Easy, Medium) → tier 0 strings → tier 1 graphs (Medium, then the
    // Hard composite whose heaviest topic is graphs); the draft never lists.
    expect(slugs(r)).toEqual(['two-sum', 'max-sub', 'anagram', 'islands', 'ladder']);
    expect(r).toMatchObject({ total: 5, page: 1, pageCount: 1, pageSize: 20 });
    expect(r.summary).toEqual({ questions: 5, solved: 0, attempted: 0 });
    expect(r.rows[4].topics.map((t) => t.slug)).toEqual(['graphs', 'strings']);
  });

  it('paginates and clamps an out-of-range page', async () => {
    await world();
    const user = await makeUser();
    const p1 = await listCatalog(user.id, Q(), { pageSize: 2 });
    expect(slugs(p1)).toEqual(['two-sum', 'max-sub']);
    expect(p1.pageCount).toBe(3);
    const last = await listCatalog(user.id, Q({ page: 9 }), { pageSize: 2 });
    expect(last.page).toBe(3);
    expect(slugs(last)).toEqual(['ladder']);
  });

  it('searches titles and tags, word by word, ignoring case', async () => {
    await world();
    const user = await makeUser();
    expect(slugs(await listCatalog(user.id, Q({ q: 'hash table' })))).toEqual(['two-sum', 'anagram']);
    expect(slugs(await listCatalog(user.id, Q({ q: 'SUB' })))).toEqual(['max-sub']);
    expect(slugs(await listCatalog(user.id, Q({ q: 'graph' })))).toEqual(['islands', 'ladder']);
    expect((await listCatalog(user.id, Q({ q: 'two xyz' }))).total).toBe(0);
  });

  it('ORs values within a facet and ANDs facets together', async () => {
    await world();
    const user = await makeUser();
    expect(slugs(await listCatalog(user.id, Q({ difficulties: ['Easy', 'Hard'] })))).toEqual(['two-sum', 'anagram', 'ladder']);
    expect(slugs(await listCatalog(user.id, Q({ tags: ['bfs', 'dynamic-programming'] })))).toEqual(['max-sub', 'islands']);
    expect(slugs(await listCatalog(user.id, Q({ companies: ['AMAZON'] })))).toEqual(['two-sum', 'anagram']);
    expect(slugs(await listCatalog(user.id, Q({ topic: 'strings' })))).toEqual(['anagram', 'ladder']);
    expect(slugs(await listCatalog(user.id, Q({ topic: 'strings', difficulties: ['Easy'] })))).toEqual(['anagram']);
    expect(slugs(await listCatalog(user.id, Q({ companies: ['Google'], tags: ['graph'] })))).toEqual(['islands']);
  });

  it('derives solved / attempted / todo from this user’s submissions only', async () => {
    const w = await world();
    const user = await makeUser();
    const other = await makeUser();
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'WA' });
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.anagram.id, kind: 'submit', status: 'WA' });
    // An accepted *run* is only an attempt.
    await makeSubmission(user.id, { questionId: w.maxSub.id, kind: 'run', status: 'OK' });
    await makeSubmission(other.id, { questionId: w.islands.id, kind: 'submit', status: 'OK' });

    const progress = await userQuestionProgress(user.id);
    expect(Object.fromEntries(progress)).toEqual({
      [w.twoSum.id]: 'solved',
      [w.anagram.id]: 'attempted',
      [w.maxSub.id]: 'attempted',
    });

    const all = await listCatalog(user.id, Q());
    expect(all.rows.map((r) => [r.slug, r.status])).toEqual([
      ['two-sum', 'solved'],
      ['max-sub', 'attempted'],
      ['anagram', 'attempted'],
      ['islands', 'todo'],
      ['ladder', 'todo'],
    ]);
    expect(all.summary).toEqual({ questions: 5, solved: 1, attempted: 2 });
    expect(slugs(await listCatalog(user.id, Q({ status: 'solved' })))).toEqual(['two-sum']);
    expect(slugs(await listCatalog(user.id, Q({ status: 'attempted' })))).toEqual(['max-sub', 'anagram']);
    expect(slugs(await listCatalog(user.id, Q({ status: 'todo' })))).toEqual(['islands', 'ladder']);
  });

  it('counts each facet with every other filter applied', async () => {
    const w = await world();
    const user = await makeUser();
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'OK' });
    const r = await listCatalog(user.id, Q({ difficulties: ['Easy'] }));
    expect(r.total).toBe(2);
    // Difficulty counts ignore the difficulty filter itself.
    expect(r.facets.difficulty).toEqual({ Easy: 2, Medium: 2, Hard: 1 });
    expect(r.facets.status).toEqual({ solved: 1, attempted: 0, todo: 1 });
    const tag = Object.fromEntries(r.facets.tags.map((t) => [t.value, t.count]));
    expect(tag).toEqual({ array: 1, bfs: 0, 'dynamic-programming': 0, graph: 0, 'hash-table': 2, string: 1 });
    // Companies merge case variants under the first spelling seen.
    const company = Object.fromEntries(r.facets.companies.map((c) => [c.value, c.count]));
    expect(company).toEqual({ Amazon: 2, Google: 1, LinkedIn: 0, Meta: 0 });
    expect(r.facets.topics.map((t) => [t.slug, t.tierOrd, t.count])).toEqual([
      ['arrays', 0, 1],
      ['strings', 0, 1],
      ['graphs', 1, 0],
    ]);
  });

  it('locks questions until every topic is unlocked, or a gate attempt is running', async () => {
    const w = await world();
    const user = await makeUser();
    const locked = async () =>
      (await listCatalog(user.id, Q())).rows.filter((r) => !r.accessible).map((r) => r.slug);

    expect(await locked()).toEqual(['islands', 'ladder']);

    const gate = await makeGate(w.tier1.id, { questionIds: [w.islands.id] });
    await prisma.gateAttempt.create({
      data: { userId: user.id, gateId: gate.id, deadlineAt: new Date(Date.now() + 3_600_000) },
    });
    expect(await locked()).toEqual(['ladder']);

    await unlockTopicRow(user.id, w.graphs.id);
    expect(await locked()).toEqual([]);
  });

  it('reports acceptance over judged submits and gate submissions of all users', async () => {
    const w = await world();
    const a = await makeUser();
    const b = await makeUser();
    await makeSubmission(a.id, { questionId: w.twoSum.id, kind: 'submit', status: 'OK' });
    await makeSubmission(b.id, { questionId: w.twoSum.id, kind: 'submit', status: 'WA' });
    await makeSubmission(b.id, { questionId: w.twoSum.id, kind: 'submit', status: 'WA' });
    await makeSubmission(b.id, { questionId: w.twoSum.id, kind: 'run', status: 'OK' }); // runs don't count
    await makeSubmission(b.id, { questionId: w.twoSum.id, kind: 'submit', status: 'queued' }); // not judged yet
    await makeSubmission(a.id, { questionId: w.anagram.id, kind: 'run', status: 'OK' });

    const rates = await acceptanceRates([w.twoSum.id, w.anagram.id, w.maxSub.id]);
    expect(Object.fromEntries(rates)).toEqual({ [w.twoSum.id]: 33.3 });
    const r = await listCatalog(a.id, Q());
    expect(r.rows.find((x) => x.slug === 'two-sum')?.acceptance).toBe(33.3);
    expect(r.rows.find((x) => x.slug === 'anagram')?.acceptance).toBeNull();
  });

  it('handles an empty catalog', async () => {
    const user = await makeUser();
    const r = await listCatalog(user.id, Q({ page: 3 }));
    expect(r).toMatchObject({ rows: [], total: 0, page: 1, pageCount: 1, summary: { questions: 0, solved: 0, attempted: 0 } });
  });
});

describe('matchesSearch', () => {
  it('needs every word in the title or a tag', () => {
    const item = { title: 'Two Sum', tags: ['array', 'hash-table'] };
    expect(matchesSearch(item, [])).toBe(true);
    expect(matchesSearch(item, ['two', 'hash'])).toBe(true);
    expect(matchesSearch(item, ['two', 'graph'])).toBe(false);
  });
});
