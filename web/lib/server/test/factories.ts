/**
 * Test data builders for DB tests. Each creates minimal valid rows with
 * unique slugs; override what the test cares about.
 */
import type { Difficulty, HintCostKind, HintLevel, Role, SupportedLanguage } from '@/lib/types';
import type { HintTarget } from '../rules/hints';
import { prisma } from './db';

let seq = 0;
const next = () => ++seq;

export async function makeUser(over: { email?: string; handle?: string; role?: Role } = {}) {
  const n = next();
  return prisma.user.create({
    data: { email: over.email ?? `user${n}@test.dev`, handle: over.handle ?? `user_${n}`, role: over.role ?? 'learner' },
  });
}

export async function makeTier(ord: number) {
  return prisma.tier.create({ data: { ord, slug: `tier-${ord}-${next()}`, title: `Tier ${ord}`, summary: '' } });
}

export async function makeTopic(tierId: string, opts: { slug?: string; ord?: number } = {}) {
  const slug = opts.slug ?? `topic-${next()}`;
  return prisma.topic.create({ data: { tierId, slug, title: slug, summary: '', icon: 'grid', ord: opts.ord ?? 0 } });
}

export async function makeQuestion(
  opts: {
    difficulty?: Difficulty;
    topics?: { topicId: string; weight?: number }[];
    status?: 'draft' | 'published';
    authorId?: string;
    slug?: string;
  } = {}
) {
  const slug = opts.slug ?? `question-${next()}`;
  return prisma.question.create({
    data: {
      slug,
      title: slug,
      difficulty: opts.difficulty ?? 'Easy',
      statementMd: '',
      examples: [],
      constraints: [],
      functionName: 'solve',
      signature: { params: [{ name: 'n', type: 'int' }], returns: 'int' },
      starterCode: {},
      tests: [{ input: [1], expected: 1, hidden: false }],
      referenceSolutions: {},
      status: opts.status ?? 'published',
      authorId: opts.authorId,
      topics: { create: (opts.topics ?? []).map((t) => ({ topicId: t.topicId, weight: t.weight ?? 1 })) },
    },
  });
}

export async function makeRecipe(
  topicId: string,
  items: { topicId: string; quantity: number; minDifficulty?: Difficulty }[],
  opts: { ord?: number; title?: string } = {}
) {
  return prisma.unlockRecipe.create({
    data: {
      topicId,
      title: opts.title ?? `recipe-${next()}`,
      ord: opts.ord ?? 0,
      items: {
        create: items.map((i) => ({ tokenTopicId: i.topicId, quantity: i.quantity, minDifficulty: i.minDifficulty ?? 'Easy' })),
      },
    },
    include: { items: true },
  });
}

export async function makeGate(
  tierId: string,
  opts: { questionIds: string[]; passThreshold?: number; cooldownHours?: number; timeLimitMinutes?: number }
) {
  return prisma.gate.create({
    data: {
      tierId,
      title: 'Gate',
      summary: '',
      passThreshold: opts.passThreshold ?? 1,
      cooldownHours: opts.cooldownHours ?? 12,
      timeLimitMinutes: opts.timeLimitMinutes ?? 60,
      questions: { create: opts.questionIds.map((questionId, ord) => ({ questionId, ord })) },
    },
  });
}

/** Hints for a question; returns them keyed by level. */
export async function makeHints(
  target: HintTarget,
  hints: { level: HintLevel; costKind?: HintCostKind; costAmount?: number }[]
) {
  const out: Partial<Record<HintLevel, { id: string }>> = {};
  for (const h of hints) {
    out[h.level] = await prisma.hint.create({
      data: {
        ...target,
        level: h.level,
        bodyMd: `${h.level} body`,
        costKind: h.costKind ?? 'score',
        costAmount: h.costAmount ?? 0,
      },
      select: { id: true },
    });
  }
  return out as Record<HintLevel, { id: string }>;
}

/** Credit tokens directly (reason admin). */
export async function grant(userId: string, topicId: string, difficulty: Difficulty, amount: number) {
  await prisma.tokenLedger.create({
    data: { userId, topicId, amount, sourceDifficulty: difficulty, reason: 'admin', refType: 'admin', refId: `grant-${next()}` },
  });
}

export async function openTier(userId: string, tierId: string) {
  await prisma.unlock.create({ data: { userId, kind: 'tier', refId: tierId } });
}

export async function unlockTopicRow(userId: string, topicId: string) {
  await prisma.unlock.create({ data: { userId, kind: 'topic', refId: topicId } });
}

/** An already-judged submission. */
export async function makeSubmission(
  userId: string,
  opts: {
    questionId?: string;
    gateAttemptId?: string;
    kind?: 'run' | 'submit' | 'gate';
    status?: 'OK' | 'WA' | 'queued';
    language?: SupportedLanguage;
    runtimeUs?: number;
    createdAt?: Date;
    code?: string;
  }
) {
  return prisma.submission.create({
    data: {
      userId,
      kind: opts.kind ?? 'submit',
      questionId: opts.questionId,
      gateAttemptId: opts.gateAttemptId,
      language: opts.language ?? 'python',
      code: opts.code ?? 'pass',
      status: opts.status ?? 'OK',
      totalPassed: 1,
      totalTests: 1,
      runtimeUs: opts.runtimeUs === undefined ? 1000n : BigInt(opts.runtimeUs),
      createdAt: opts.createdAt,
    },
  });
}

/** Net balance (all difficulties) of one topic, straight from the ledger. */
export async function balanceOf(userId: string, topicId: string): Promise<number> {
  const r = await prisma.tokenLedger.aggregate({ where: { userId, topicId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/**
 * A small loop: tier 0 (arrays, strings — free), tier 1 (graphs, dp)
 * opened by a gate over two tier-0 questions.
 */
export async function makeWorld() {
  const tier0 = await makeTier(0);
  const tier1 = await makeTier(1);
  const arrays = await makeTopic(tier0.id, { slug: 'arrays', ord: 0 });
  const strings = await makeTopic(tier0.id, { slug: 'strings', ord: 1 });
  const graphs = await makeTopic(tier1.id, { slug: 'graphs', ord: 0 });
  const dp = await makeTopic(tier1.id, { slug: 'dp', ord: 1 });
  const q1 = await makeQuestion({ slug: 'q-arrays', topics: [{ topicId: arrays.id }] });
  const q2 = await makeQuestion({ slug: 'q-strings', topics: [{ topicId: strings.id }] });
  const gate = await makeGate(tier1.id, { questionIds: [q1.id, q2.id], passThreshold: 2, cooldownHours: 12 });
  return { tier0, tier1, arrays, strings, graphs, dp, q1, q2, gate };
}
