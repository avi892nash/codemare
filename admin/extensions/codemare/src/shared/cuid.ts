/**
 * Collision-resistant ids in the format Prisma's `@default(cuid())` produces
 * (cuid v1: 'c' + time + counter + fingerprint + random, 25 chars of base 36).
 *
 * content.* ids have no database default — Prisma generates them in the
 * client — so rows created through Directus get one from the create hook.
 * Keeping Prisma's format means Directus-made rows are indistinguishable.
 */
import { randomInt } from 'node:crypto';
import { hostname } from 'node:os';

const BASE = 36;
const BLOCK = 4;
const DISCRETE = BASE ** BLOCK;

const pad = (s: string, size: number) => s.padStart(size, '0').slice(-size);

let counter = randomInt(DISCRETE);

const fingerprint = (() => {
  const pid = pad(process.pid.toString(BASE), 2);
  const host = hostname();
  let sum = host.length + BASE;
  for (const ch of host) sum += ch.charCodeAt(0);
  return pid + pad(sum.toString(BASE), 2);
})();

const randomBlock = () => pad(randomInt(DISCRETE).toString(BASE), BLOCK);

export function cuid(): string {
  counter = counter < DISCRETE - 1 ? counter + 1 : 0;
  return (
    'c' +
    Date.now().toString(BASE) +
    pad(counter.toString(BASE), BLOCK) +
    fingerprint +
    randomBlock() +
    randomBlock()
  );
}
