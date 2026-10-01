/**
 * The real content, end to end through the domain layer. Runs when a
 * content directory exists: prisma/seed/data (after the content lands), or
 * SEED_DIR. Seeds it into the test database, checks every JSON column parses
 * where the services read it, then plays the whole loop as a fresh learner —
 * gates, solves, cheapest unlocks — until every topic is unlocked. Solving
 * questions is the only way to earn tokens, so this is also the proof that
 * the content's recipes are affordable.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canAccessQuestion, getMapState, unlockTopic } from '../../lib/server/access';
import { onAcceptedSubmit } from '../../lib/server/awards';
import { evaluateBadges } from '../../lib/server/badges';
import { finishGate, startGate } from '../../lib/server/gates';
import { getHintLadder } from '../../lib/server/hints';
import { parseJsonColumn, signatureSchema, testDefSchema } from '../../lib/server/schemas';
import { completeSubmission, createSubmission } from '../../lib/server/submissions';
import { prisma, resetDatabase } from '../../lib/server/test/db';
import { DEFAULT_SEED_DIR, runSeed } from './run';

const dir = process.env.SEED_DIR ? resolve(process.env.SEED_DIR) : DEFAULT_SEED_DIR;
const accepted = { status: 'OK' as const, tests: [{ idx: 0, passed: true, hidden: false, runtimeUs: 100, memoryKb: 1024 }] };

describe.skipIf(!existsSync(dir))(`seed content (${dir})`, () => {
  it('seeds, parses everywhere, and plays through every tier', { timeout: 180_000 }, async () => {
    await resetDatabase();
    const warn = vi.spyOn(console, 'warn');
    await runSeed({ dir, prisma });

    // JSON columns parse where services read them.
    for (const q of await prisma.question.findMany()) {
      parseJsonColumn(signatureSchema, q.signature, `${q.slug}.signature`);
      for (const t of q.tests as unknown[]) parseJsonColumn(testDefSchema, t, `${q.slug}.tests`);
    }

    const user = await prisma.user.create({ data: { email: 'player@test.dev', handle: 'player' } });
    expect(await evaluateBadges(user.id)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    for (const q of await prisma.question.findMany({ select: { id: true } })) {
      const ladder = await getHintLadder(user.id, { questionId: q.id });
      if (ladder.rungs.length) expect(ladder.rungs[0]).toMatchObject({ level: 'nudge', revealable: true });
    }

    // Play: pass each gate, then solve everything reachable and spend the
    // cheapest ready recipe until nothing changes.
    const solved = new Set<string>();
    const tiers = await prisma.tier.findMany({ orderBy: { ord: 'asc' }, include: { gate: { include: { questions: true } } } });
    for (const tier of tiers) {
      if (tier.gate) {
        const attempt = await startGate(user.id, tier.gate.id);
        for (const gq of tier.gate.questions) {
          const s = await createSubmission({
            userId: user.id,
            kind: 'gate',
            language: 'python',
            code: '',
            questionId: gq.questionId,
            gateAttemptId: attempt.id,
          });
          await completeSubmission(s.id, accepted);
          await onAcceptedSubmit(user.id, s.id);
        }
        const finished = await finishGate(user.id, attempt.id);
        expect(finished.passed, `gate of tier ${tier.slug}`).toBe(true);
      }

      for (let progress = true; progress; ) {
        progress = false;
        for (const q of await prisma.question.findMany({ where: { status: 'published' }, select: { id: true } })) {
          if (solved.has(q.id) || !(await canAccessQuestion(user.id, q.id)).ok) continue;
          const s = await createSubmission({ userId: user.id, kind: 'submit', language: 'python', code: '', questionId: q.id });
          await completeSubmission(s.id, accepted);
          await onAcceptedSubmit(user.id, s.id);
          solved.add(q.id);
          progress = true;
        }
        const map = await getMapState(user.id);
        for (const topic of map.tiers.filter((t) => t.open).flatMap((t) => t.topics)) {
          if (topic.status !== 'unlockable') continue;
          expect((await unlockTopic(user.id, topic.id)).status).toBe('unlocked');
          progress = true;
        }
      }
    }

    const map = await getMapState(user.id);
    const locked = map.tiers.flatMap((t) => t.topics).filter((t) => t.status !== 'unlocked');
    expect(locked.map((t) => t.slug), 'topics a learner can never unlock').toEqual([]);
    expect(map.tiers.every((t) => t.open)).toBe(true);
    // Nothing overdrew along the way.
    const negative = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM (
        SELECT topic_id, source_difficulty FROM app.token_ledger GROUP BY 1, 2 HAVING sum(amount) < 0
      ) x`;
    expect(Number(negative[0].n)).toBe(0);
    warn.mockRestore();
  });
});
