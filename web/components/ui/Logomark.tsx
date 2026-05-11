/* The product mark — `</>` on an indigo gradient. */
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
        fontSize: size * 0.55,
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
