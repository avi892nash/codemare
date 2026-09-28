/**
 * Pure handle rules. A handle is unique, lowercase `[a-z0-9_]{3,24}`
 * (enforced by a CHECK constraint on app.users.handle).
 */

export const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
/** What a sign-up form may accept before lowercasing. */
export const HANDLE_INPUT_RE = /^[a-zA-Z0-9_]{3,24}$/;

export function isValidHandle(h: string): boolean {
  return HANDLE_RE.test(h);
}

/**
 * Best-effort handle from free text (a GitHub login, a display name, an
 * email local part): lowercase, runs of other characters → `_`, trimmed to
 * 24. Returns null when fewer than 3 usable characters remain.
 */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/g, '');
  return h.length >= 3 ? h : null;
}

/** `base` with a numeric suffix, trimmed so the result still fits 24 chars. */
export function withSuffix(base: string, suffix: number | string): string {
  const s = String(suffix);
  return `${base.slice(0, 24 - s.length)}${s}`;
}
