/**
 * Role ordering (spec §3.9): learner < author < staff < admin.
 */
import { ROLES, type Role } from '@/lib/types';

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/** True when `role` is at least `min`. A missing role counts as `learner`. */
export function hasRole(role: Role | null | undefined, min: Role): boolean {
  return roleRank(role ?? 'learner') >= roleRank(min);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
