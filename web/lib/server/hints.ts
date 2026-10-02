import 'server-only';
import type { HintCostKind, HintLevel } from '@/lib/types';
import { prisma, withUserLock, type Db } from './db';
import { canAccessQuestion, type TopicRef } from './access';
import { AccessDenied, HintLocked, NotFoundError } from './errors';
import { getBalances, getScorePenalty, spend, type Debit } from './ledger';
import { ladderState, unrevealedBelow, type HintTarget } from './rules/hints';
import { qualifyingBalance } from './rules/recipes';

export { getScorePenalty };
export type { HintTarget };

/**
 * The hint ladder (spec §3.6): nudge → concept → pseudo → line → solution.
 * A level is revealable once every lower level is revealed. The cost is
 * shown before reveal:
 *   score — % penalty on the question's future token award
 *   token — `cost_amount` tokens of the question's highest-weight topic,
 *           spent via the ledger
 * The first reveal writes hint_uses; re-viewing is free.
 */

export interface HintRung {
  hintId: string;
  level: HintLevel;
  costKind: HintCostKind;
  costAmount: number;
  revealed: boolean;
  revealable: boolean;
  /** Markdown body — only once revealed. */
  bodyMd: string | null;
  /** Token costs: the topic that pays. */
  tokenTopic: TopicRef | null;
  /** Token costs: whether the user holds enough tokens right now (score costs: true). */
  affordable: boolean;
}

export interface HintLadder {
  target: HintTarget;
  rungs: HintRung[];
  /** Current score penalty (%) on this target's award. */
  penalty: number;
}

export interface RevealResult {
  hint: { id: string; level: HintLevel; bodyMd: string };
  cost: { kind: HintCostKind; amount: number };
  /** true → it was revealed before; nothing charged. */
  alreadyRevealed: boolean;
  /** Token debits made by this reveal. */
  debits: Debit[];
  /** Score penalty (%) on the target after this reveal. */
  penalty: number;
}

/** The topic whose tokens pay for token-cost hints on `target`: the question's highest-weight topic. */
async function tokenTopicFor(target: HintTarget, db: Db): Promise<TopicRef | null> {
  const rows = await db.questionTopic.findMany({
    where: { questionId: target.questionId },
    select: { weight: true, topic: { select: { id: true, slug: true, title: true, icon: true } } },
  });
  rows.sort((a, b) => b.weight - a.weight || a.topic.slug.localeCompare(b.topic.slug));
  return rows[0]?.topic ?? null;
}

async function assertTargetAccess(userId: string, target: HintTarget): Promise<void> {
  const access = await canAccessQuestion(userId, target.questionId);
  if (!access.ok) throw new AccessDenied(access.reason, 'Unlock this first to see its hints.');
}

/** The ladder for a question: every rung's cost and state. */
export async function getHintLadder(userId: string, target: HintTarget): Promise<HintLadder> {
  const [hints, uses, penalty, tokenTopic] = await Promise.all([
    prisma.hint.findMany({
      where: { questionId: target.questionId },
      select: { id: true, level: true, bodyMd: true, costKind: true, costAmount: true },
    }),
    prisma.hintUse.findMany({ where: { userId, questionId: target.questionId }, select: { hintId: true } }),
    getScorePenalty(userId, target),
    tokenTopicFor(target, prisma),
  ]);
  const needsTokens = hints.some((h) => h.costKind === 'token' && h.costAmount > 0);
  const balances = needsTokens && tokenTopic ? await getBalances(userId, { topicIds: [tokenTopic.id] }) : {};
  const held = tokenTopic ? qualifyingBalance(balances, tokenTopic.id, 'Easy') : 0;

  return {
    target,
    penalty,
    rungs: ladderState(hints, new Set(uses.map((u) => u.hintId))).map((h) => ({
      hintId: h.id,
      level: h.level,
      costKind: h.costKind,
      costAmount: h.costAmount,
      revealed: h.revealed,
      revealable: h.revealable,
      bodyMd: h.revealed ? h.bodyMd : null,
      tokenTopic: h.costKind === 'token' ? tokenTopic : null,
      affordable: h.costKind === 'score' || h.costAmount === 0 || held >= h.costAmount,
    })),
  };
}

/**
 * Reveal a hint (the caller has shown the cost and got confirmation).
 * Enforces ladder order (HintLocked) and access (AccessDenied); a token cost
 * is spent atomically with the hint_uses row (InsufficientTokens → nothing
 * written). Re-revealing is free and returns the body again.
 */
export async function revealHint(userId: string, hintId: string): Promise<RevealResult> {
  const hint = await prisma.hint.findUnique({
    where: { id: hintId },
    select: { id: true, level: true, bodyMd: true, costKind: true, costAmount: true, questionId: true },
  });
  if (!hint) throw new NotFoundError('hint', hintId);
  const target: HintTarget = { questionId: hint.questionId };
  await assertTargetAccess(userId, target);

  const { alreadyRevealed, debits } = await withUserLock(userId, async (tx) => {
    const used = await tx.hintUse.findUnique({ where: { userId_hintId: { userId, hintId } }, select: { id: true } });
    if (used) return { alreadyRevealed: true, debits: [] as Debit[] };

    const ladder = await tx.hint.findMany({ where: { questionId: target.questionId }, select: { id: true, level: true } });
    const revealed = await tx.hintUse.findMany({ where: { userId, questionId: target.questionId }, select: { hintId: true } });
    const missing = unrevealedBelow(ladder, new Set(revealed.map((r) => r.hintId)), hintId);
    if (missing.length > 0) throw new HintLocked(missing);

    let debits: Debit[] = [];
    if (hint.costKind === 'token' && hint.costAmount > 0) {
      const topic = await tokenTopicFor(target, tx);
      if (!topic) throw new NotFoundError('hint topic', hintId);
      debits = await spend(
        userId,
        [{ topicId: topic.id, quantity: hint.costAmount, minDifficulty: 'Easy' }],
        { reason: 'hint', refType: 'hint', refId: hint.id },
        tx
      );
    }
    await tx.hintUse.create({
      data: {
        userId,
        hintId,
        questionId: target.questionId,
        costKind: hint.costKind,
        costAmount: hint.costAmount,
      },
    });
    return { alreadyRevealed: false, debits };
  });

  return {
    hint: { id: hint.id, level: hint.level, bodyMd: hint.bodyMd },
    cost: { kind: hint.costKind, amount: hint.costAmount },
    alreadyRevealed,
    debits,
    penalty: await getScorePenalty(userId, target),
  };
}
