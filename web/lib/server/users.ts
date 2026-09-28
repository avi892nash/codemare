import 'server-only';
import { Prisma, type User } from '@prisma/client';
import { prisma, type Db } from './db';
import { DomainError } from './errors';
import { isValidHandle, normalizeHandle, withSuffix } from './rules/handles';

/**
 * User creation with a guaranteed unique handle (app.users.handle is
 * NOT NULL UNIQUE, lowercase [a-z0-9_]{3,24}). Imported by auth.ts, so it
 * stays free of Node-only modules (middleware bundles it).
 */

/** Random integer in [min, max) — suffixes need uniqueness, not secrecy. */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

export class HandleTaken extends DomainError {
  readonly code = 'handle_taken';
  readonly status = 409;
  constructor(readonly handle: string) {
    super('That handle is taken');
    this.name = 'HandleTaken';
  }
}

export class EmailTaken extends DomainError {
  readonly code = 'email_taken';
  readonly status = 409;
  constructor() {
    super('An account with that email already exists');
    this.name = 'EmailTaken';
  }
}

/** Which unique column a P2002 error is about, if any. */
function uniqueViolation(e: unknown): 'handle' | 'email' | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return null;
  const target = String(e.meta?.target ?? '');
  if (target.includes('handle')) return 'handle';
  if (target.includes('email')) return 'email';
  return null;
}

export async function isHandleAvailable(handle: string, db: Db = prisma): Promise<boolean> {
  return (await db.user.findUnique({ where: { handle }, select: { id: true } })) === null;
}

/**
 * A free handle derived from the first usable seed (GitHub login, name,
 * email local part …): the seed itself if free, else seed + digits.
 */
export async function generateHandle(seeds: readonly (string | null | undefined)[], db: Db = prisma): Promise<string> {
  const bases = [...new Set(seeds.map(normalizeHandle).filter((s): s is string => s !== null))];
  if (bases.length === 0) bases.push('coder');
  for (const base of bases) if (await isHandleAvailable(base, db)) return base;
  const base = bases[0];
  for (let digits = 2; digits <= 6; digits++) {
    for (let i = 0; i < 4; i++) {
      const candidate = withSuffix(base, randomInt(10 ** (digits - 1), 10 ** digits));
      if (await isHandleAvailable(candidate, db)) return candidate;
    }
  }
  return withSuffix(base, Date.now().toString(36));
}

/**
 * Create a user. With `handle` (already validated and lowercased — the
 * user's choice) a clash throws HandleTaken; otherwise a handle is generated
 * from `seeds`, retrying on the rare concurrent clash. A duplicate email
 * throws EmailTaken.
 */
export async function createUserWithHandle(
  data: Omit<Prisma.UserCreateInput, 'handle'>,
  opts: { handle?: string; seeds?: readonly (string | null | undefined)[] } = {}
): Promise<User> {
  if (opts.handle !== undefined && !isValidHandle(opts.handle)) {
    throw new Error(`invalid handle: ${opts.handle}`);
  }
  for (let attempt = 0; ; attempt++) {
    const handle = opts.handle ?? (await generateHandle(opts.seeds ?? [data.name, data.email.split('@')[0]]));
    try {
      return await prisma.user.create({ data: { ...data, handle } });
    } catch (e) {
      const clash = uniqueViolation(e);
      if (clash === 'email') throw new EmailTaken();
      if (clash === 'handle') {
        if (opts.handle !== undefined) throw new HandleTaken(handle);
        if (attempt < 5) continue;
      }
      throw e;
    }
  }
}
