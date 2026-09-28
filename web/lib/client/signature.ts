/**
 * Pure helpers over a question's typed signature (spec §2.1): value ↔ text
 * for the custom-input editor and the per-test breakdown, and the same
 * conformance rules the compile service applies to typed languages — so a
 * bad custom input is caught with a readable message before anything runs.
 * No DOM or server imports: the runner uses these too.
 */
import type { Signature, SignatureBaseType, SignatureType, SupportedLanguage } from '@/lib/types';

export function parseSignatureType(type: SignatureType): { base: SignatureBaseType; dims: number } {
  const m = /^(int|long|double|bool|string|char)((?:\[\])*)$/.exec(type);
  if (!m) throw new Error(`unsupported signature type ${type}`);
  return { base: m[1] as SignatureBaseType, dims: m[2].length / 2 };
}

function describe(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function scalarError(base: SignatureBaseType, v: unknown, language?: SupportedLanguage): string | null {
  switch (base) {
    case 'int':
      return Number.isInteger(v) && (v as number) >= -2147483648 && (v as number) <= 2147483647
        ? null
        : `expected an int (32-bit integer), got ${describe(v)}`;
    case 'long':
      return Number.isSafeInteger(v) ? null : `expected a long (integer within ±2^53), got ${describe(v)}`;
    case 'double':
      return typeof v === 'number' && Number.isFinite(v) ? null : `expected a number, got ${describe(v)}`;
    case 'bool':
      return typeof v === 'boolean' ? null : `expected true or false, got ${describe(v)}`;
    case 'string':
      return typeof v === 'string' ? null : `expected a "string", got ${describe(v)}`;
    case 'char': {
      const ok = typeof v === 'string' && v.length === 1 && (language === 'java' || v.charCodeAt(0) <= 0x7f);
      return ok ? null : `expected a single character like "a", got ${describe(v)}`;
    }
  }
}

/** First mismatch between `value` and a signature type (null when it conforms). */
export function conformanceError(type: SignatureType, value: unknown, language?: SupportedLanguage): string | null {
  const { base, dims } = parseSignatureType(type);
  const walk = (v: unknown, d: number, at: string): string | null => {
    if (d === 0) {
      const err = scalarError(base, v, language);
      return err ? `${at ? `${at}: ` : ''}${err}` : null;
    }
    if (!Array.isArray(v)) return `${at ? `${at}: ` : ''}expected ${base}${'[]'.repeat(d)}, got ${describe(v)}`;
    for (let k = 0; k < v.length; k++) {
      const err = walk(v[k], d - 1, `${at}[${k}]`);
      if (err) return err;
    }
    return null;
  };
  return walk(value, dims, '');
}

/**
 * Check one argument list against the signature: arity, then each value's
 * type. Returns a message naming the parameter, or null.
 */
export function argumentsError(signature: Signature, args: readonly unknown[], language?: SupportedLanguage): string | null {
  if (args.length !== signature.params.length) {
    return `expected ${signature.params.length} argument${signature.params.length === 1 ? '' : 's'} (${signature.params
      .map((p) => p.name)
      .join(', ')}), got ${args.length}`;
  }
  for (let i = 0; i < args.length; i++) {
    const p = signature.params[i];
    const err = conformanceError(p.type, args[i], language);
    if (err) return `${p.name}${err.startsWith('[') ? err : `: ${err}`}`;
  }
  return null;
}

/** Parse one parameter's text (JSON) — `{ok: false}` carries a short reason. */
export function parseArgText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'empty' };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // The most common slip: an unquoted string.
    if (/^[A-Za-z_][\w ]*$/.test(trimmed) && !['true', 'false', 'null'].includes(trimmed)) {
      return { ok: false, error: `strings need quotes: "${trimmed}"` };
    }
    return { ok: false, error: 'not valid JSON' };
  }
}

/**
 * Compact one-line JSON for a value — the notation the statements' examples
 * use (`[2,7,11,15]`) and learners type. Long values are cut at `max` chars.
 */
export function formatValue(value: unknown, max = 4000): string {
  if (value === undefined) return '';
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)} … (${(text.length - max).toLocaleString('en-US')} more chars)` : text;
}

/** Plain JSON text (no added spaces) — for editable fields. */
export function valueToText(value: unknown): string {
  return JSON.stringify(value) ?? '';
}

/** `name = value` pairs for an argument list (falls back to arg0… without a signature). */
export function namedArgs(signature: Signature | null | undefined, input: unknown): { name: string; value: unknown }[] {
  const args = Array.isArray(input) ? input : [input];
  return args.map((value, i) => ({ name: signature?.params[i]?.name ?? `arg${i}`, value }));
}
