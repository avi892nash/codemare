/* Two-letter language mark using the language's brand hue but no proprietary
 * logos. Sits on every submission row, language picker, and the header of
 * code blocks.
 *
 * The two letters are real text, so they follow the type floor: always at
 * least 12 px (`--fs-xs`), in a small rounded tag that grows to fit them.
 * `size` is the size of the text the mark sits beside (11–14 px in the app):
 * the tag is about 1.5× that tall, and its letters never go below 12 px. */
const LANG_META: Record<string, { c: string; t: string }> = {
  Python:     { c: 'oklch(0.78 0.14 220)', t: 'Py' },
  python:     { c: 'oklch(0.78 0.14 220)', t: 'Py' },
  JavaScript: { c: 'oklch(0.84 0.14 80)',  t: 'JS' },
  javascript: { c: 'oklch(0.84 0.14 80)',  t: 'JS' },
  'C++':      { c: 'oklch(0.74 0.14 250)', t: 'C+' },
  cpp:        { c: 'oklch(0.74 0.14 250)', t: 'C+' },
  Java:       { c: 'oklch(0.72 0.18 22)',  t: 'Jv' },
  java:       { c: 'oklch(0.72 0.18 22)',  t: 'Jv' },
  Go:         { c: 'oklch(0.78 0.12 200)', t: 'Go' },
  go:         { c: 'oklch(0.78 0.12 200)', t: 'Go' },
  Rust:       { c: 'oklch(0.78 0.14 40)',  t: 'Rs' },
  Kotlin:     { c: 'oklch(0.78 0.14 320)', t: 'Kt' },
  TypeScript: { c: 'oklch(0.74 0.14 240)', t: 'Ts' },
  typescript: { c: 'oklch(0.74 0.14 240)', t: 'Ts' },
};

/* Decorative: the language name is always printed or announced nearby. */
export function LangMark({ lang, size = 14 }: { lang: string; size?: number }) {
  const meta = LANG_META[lang] ?? { c: 'var(--fg-3)', t: (lang || '?').slice(0, 2) };
  const height = Math.max(20, Math.round(size * 1.5));
  return (
    <span
      aria-hidden="true"
      className="mono"
      style={{
        minWidth: height + 6,
        height,
        padding: '0 4px',
        boxSizing: 'border-box',
        borderRadius: 'var(--r-sm)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${meta.c} 18%, transparent)`,
        // --mark-mix (globals.css) keeps the brand hue in dark and darkens it in light for AA.
        color: `color-mix(in oklab, ${meta.c} var(--mark-mix), var(--fg-0))`,
        fontSize: `max(var(--fs-xs), ${(size * 0.8).toFixed(1)}px)`,
        fontWeight: 600,
        lineHeight: 1,
        border: `1px solid color-mix(in oklab, ${meta.c} 30%, transparent)`,
        flex: 'none',
      }}
    >
      {meta.t}
    </span>
  );
}
