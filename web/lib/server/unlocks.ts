import 'server-only';
import { prisma, type Db } from './db';

/**
 * Unlock state (spec §3.4):
 *   · the tier with ord 0 is always open and its topics always unlocked
 *     (no rows are written for them);
 *   · tier N > 0 is open iff unlocks(kind=tier, ref=tier_id) exists
 *     (written when its gate is passed);
 *   · a topic in tier N > 0 is unlocked iff unlocks(kind=topic, ref=topic_id)
 *     exists (written when a recipe is spent — only possible once its tier
 *     is open, and tiers never close).
 */

/** Ids of every tier open for the user, tier 0 included. */
export async function getOpenTierIds(userId: string, db: Db = prisma): Promise<Set<string>> {
  const [free, rows] = await Promise.all([
    db.tier.findMany({ where: { ord: 0 }, select: { id: true } }),
    db.unlock.findMany({ where: { userId, kind: 'tier' }, select: { refId: true } }),
  ]);
  return new Set([...free.map((t) => t.id), ...rows.map((r) => r.refId)]);
}

export async function isTierOpen(userId: string, tierId: string, db: Db = prisma): Promise<boolean> {
  const tier = await db.tier.findUnique({ where: { id: tierId }, select: { ord: true } });
  if (!tier) return false;
  if (tier.ord === 0) return true;
  const row = await db.unlock.findUnique({
    where: { userId_kind_refId: { userId, kind: 'tier', refId: tierId } },
    select: { id: true },
  });
  return row !== null;
}

/** Ids of every topic unlocked for the user, free-tier topics included. */
export async function getUnlockedTopicIds(userId: string, db: Db = prisma): Promise<Set<string>> {
  const [free, rows] = await Promise.all([
    db.topic.findMany({ where: { tier: { ord: 0 } }, select: { id: true } }),
    db.unlock.findMany({ where: { userId, kind: 'topic' }, select: { refId: true } }),
  ]);
  return new Set([...free.map((t) => t.id), ...rows.map((r) => r.refId)]);
}

export async function isTopicUnlocked(userId: string, topicId: string, db: Db = prisma): Promise<boolean> {
  const topic = await db.topic.findUnique({ where: { id: topicId }, select: { tier: { select: { ord: true } } } });
  if (!topic) return false;
  if (topic.tier.ord === 0) return true;
  const row = await db.unlock.findUnique({
    where: { userId_kind_refId: { userId, kind: 'topic', refId: topicId } },
    select: { id: true },
  });
  return row !== null;
}
