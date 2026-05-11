/* Deterministic colored initials avatar. Hue is derived from the name so the
 * same user always gets the same color, with no proprietary identity provider. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s|_|-/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 47) % 360;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: `oklch(0.42 0.10 ${hue})`,
        border: `1px solid oklch(0.5 0.10 ${hue})`,
        color: '#fff',
        fontSize: size * 0.4,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        flex: 'none',
      }}
    >
      {initials}
    </div>
  );
}
