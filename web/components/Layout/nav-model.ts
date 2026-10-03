import type { IconName } from '@/components/ui/Icon';

/* Pure data + helpers for the app shell. No React, no server imports, so
 * both the workspace layout (server) and the Navbar (client) can use it. */

export const NAV_ROLES = ['learner', 'author', 'staff', 'admin'] as const;
export type NavRole = (typeof NAV_ROLES)[number];

export function parseRole(value: unknown): NavRole {
  return typeof value === 'string' && (NAV_ROLES as readonly string[]).includes(value) ? (value as NavRole) : 'learner';
}

/** learner < author < staff < admin (architecture §3.9). */
export function roleAtLeast(role: NavRole, min: NavRole): boolean {
  return NAV_ROLES.indexOf(role) >= NAV_ROLES.indexOf(min);
}

export interface NavUser {
  name: string;
  /** Public handle (without @); null until the user has one. */
  handle: string | null;
  image: string | null;
  role: NavRole;
}

export interface NavSection {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Extra prefixes that count as this section. */
  also?: string[];
  /** Exact paths that count as this section. */
  exact?: string[];
}

// The tier map is home: the logo opens it (`/` → /map when signed in), and
// it lists every topic's problems — there is no separate problem list.
export const NAV_SECTIONS: NavSection[] = [
  { key: 'learn', label: 'Learn', href: '/learn', icon: 'graduation' },
  { key: 'map', label: 'Map', href: '/map', icon: 'map' },
  { key: 'ide', label: 'IDE', href: '/ide', icon: 'terminal' },
  { key: 'submissions', label: 'Submissions', href: '/submissions', icon: 'history' },
];

const underPrefix = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function isSectionActive(section: NavSection, pathname: string): boolean {
  if (section.exact?.includes(pathname)) return true;
  return [section.href, ...(section.also ?? [])].some((p) => underPrefix(pathname, p));
}

/**
 * Session user → NavUser without trusting its shape: `role` and `handle` are
 * being added to the session in parallel, so read them as unknown and fall
 * back (learner / no handle) when absent or malformed.
 */
export function toNavUser(
  user: { name?: string | null; email?: string | null; image?: string | null } | null | undefined,
): NavUser | null {
  if (!user) return null;
  const extra: Record<string, unknown> = { ...user };
  const handle = typeof extra.handle === 'string' && extra.handle.trim() ? extra.handle.trim() : null;
  return {
    name: user.name?.trim() || handle || user.email || 'You',
    handle,
    image: typeof user.image === 'string' && user.image ? user.image : null,
    role: parseRole(extra.role),
  };
}

/** Compact token count for the navbar chip: 980 · 12.4k · 1.2M. */
export function formatTokens(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
