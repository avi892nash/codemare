/* The product mark — `</>` on an indigo gradient. The glyphs are text, so they
 * sit on the type scale (12 px) and never below the floor; the mark is 22 px by default. */
export function Logomark({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        background: 'linear-gradient(140deg, var(--accent), oklch(0.55 0.18 280))',
        color: '#0b0a14',
        fontWeight: 700,
        // 12 px (--fs-xs) for the sizes the app uses (20–26); larger marks scale
        fontSize: size <= 26 ? 'var(--fs-xs)' : size * 0.55,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
        letterSpacing: -0.5,
      }}
    >
      {'</>'}
    </span>
  );
}
