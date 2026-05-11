/* Two-letter language badge using the language's brand hue but no
 * proprietary logos. Sits on every problem row, language picker, and the
 * tabs of runnable code blocks. */
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
  Rust:       { c: 'oklch(0.78 0.14 40)',  t: 'Rs' },
  Kotlin:     { c: 'oklch(0.78 0.14 320)', t: 'Kt' },
  TypeScript: { c: 'oklch(0.74 0.14 240)', t: 'Ts' },
};

export function LangMark({ lang, size = 14 }: { lang: string; size?: number }) {
  const meta = LANG_META[lang] ?? { c: 'var(--fg-3)', t: (lang || '?').slice(0, 2) };
  return (
    <span
      className="mono"
      style={{
        width: size + 2,
        height: size + 2,
        borderRadius: 3,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${meta.c} 18%, transparent)`,
        color: meta.c,
        fontSize: size * 0.66,
        fontWeight: 600,
        border: `1px solid color-mix(in oklab, ${meta.c} 30%, transparent)`,
        flex: 'none',
      }}
    >
      {meta.t}
    </span>
  );
}
