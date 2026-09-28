/**
 * Codemare domain layer (docs/spec/architecture.md §3–4). Server-only.
 *
 *   import { unlockTopic, getMapState, isDomainError } from '@/lib/server';
 *
 * Every rule lives here — pages, server actions and route handlers call
 * these and never re-implement one. Expected failures are typed
 * DomainErrors (errors.ts) carrying `code` + HTTP `status`.
 *
 * Pure rule modules (lib/server/rules/*, schemas.ts, errors.ts) have no DB
 * or server-only import and may be imported directly anywhere, including
 * client components.
 */
import 'server-only';

export * from './errors';
export * from './ledger';
export * from './access';
export * from './gates';
export * from './hints';
export * from './components';
export * from './submissions';
export * from './awards';
export * from './badges';
export * from './steps';
export * from './learn';
export * from './users';

export { hasRole, roleRank, isRole } from './rules/roles';
export { withUserLock, TX_OPTIONS, type Db, type Tx } from './db';
