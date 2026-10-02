/**
 * Per-problem, per-language code drafts in localStorage, plus the language
 * last used for a problem and overall. Every access is guarded: storage can
 * be unavailable (private mode, blocked site data) and the editor must still
 * work — it just forgets.
 *
 * Scopes: `q:<questionId>`, `ide`.
 */
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';

const PREFIX = 'cm:v1';
const draftKey = (scope: string, language: string) => `${PREFIX}:draft:${scope}:${language}`;
const langKey = (scope: string) => `${PREFIX}:lang:${scope}`;
const PREFERRED = `${PREFIX}:lang`;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // quota / blocked — drafts are a convenience
  }
}

export function loadDraft(scope: string, language: SupportedLanguage): string | null {
  return read(draftKey(scope, language));
}

/** Save a draft; saving the starter code (or nothing) clears it instead. */
export function saveDraft(scope: string, language: SupportedLanguage, code: string, starter?: string): void {
  write(draftKey(scope, language), code === (starter ?? '') || code.trim() === '' ? null : code);
}

export function clearDraft(scope: string, language: SupportedLanguage): void {
  write(draftKey(scope, language), null);
}

function asLanguage(v: string | null, allowed?: readonly SupportedLanguage[]): SupportedLanguage | null {
  if (!v || !(LANGUAGES as readonly string[]).includes(v)) return null;
  const lang = v as SupportedLanguage;
  return !allowed || allowed.includes(lang) ? lang : null;
}

/** The language last used for this scope, else the one used anywhere last. */
export function loadLanguage(scope: string, allowed?: readonly SupportedLanguage[]): SupportedLanguage | null {
  return asLanguage(read(langKey(scope)), allowed) ?? asLanguage(read(PREFERRED), allowed);
}

export function saveLanguage(scope: string, language: SupportedLanguage): void {
  write(langKey(scope), language);
  write(PREFERRED, language);
}
