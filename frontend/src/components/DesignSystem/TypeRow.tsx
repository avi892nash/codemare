/* One row of the type scale showcase. Three columns: label, size/weight, sample. */
export function TypeRow({
  size, weight, label, sample, font = 'var(--font-sans)',
}: {
  size: number;
  weight: number;
  label: string;
  sample: string;
  font?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 80px 1fr',
        gap: 16,
        alignItems: 'baseline',
        paddingBottom: 14,
        borderBottom: '1px solid var(--line-1)',
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{size}/{weight}</span>
      <span
        style={{
          fontFamily: font,
          fontSize: size,
          fontWeight: weight,
          color: 'var(--fg-0)',
          lineHeight: 1.15,
          letterSpacing: size > 30 ? -0.4 : -0.1,
        }}
      >
        {sample}
      </span>
    </div>
  );
}
