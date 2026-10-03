/* Deterministic colored initials avatar. Hue is derived from the name so the
 * same user always gets the same color, with no proprietary identity provider.
 * With `src` (e.g. a GitHub avatar) the image covers the initials; if it
 * fails to load, the initials show through. Decorative: the user's name is
 * always printed next to it, so it is aria-hidden.
 *
 * Initials follow the type floor: never smaller than 12 px (`--fs-xs`), so
 * the circle has to be at least 28 px to carry two letters; a smaller
 * avatar is a plain colored disc without initials. Larger avatars scale the
 * initials at 40 % of the diameter. */
const MIN_INITIALS_SIZE = 28;

export function Avatar({ name, size = 28, src }: { name: string; size?: number; src?: string | null }) {
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
      aria-hidden="true"
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: 999,
        overflow: 'hidden',
        background: `oklch(0.42 0.10 ${hue})`,
        border: `1px solid oklch(0.5 0.10 ${hue})`,
        color: '#fff',
        fontSize: `max(var(--fs-xs), ${size * 0.4}px)`,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-sans)',
        flex: 'none',
      }}
    >
      {size >= MIN_INITIALS_SIZE && initials}
      {src && (
        // Remote avatars (GitHub, Google) — next/image would need per-host config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}
