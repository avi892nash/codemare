/* Single color swatch — height + border + name + token reference. */
export function DSSwatch({ name, value, mono = 'var(--fg-2)' }: { name: string; value: string; mono?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          height: 56,
          borderRadius: 8,
          background: value,
          border: '1px solid var(--line-2)',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--fg-1)', fontWeight: 500 }}>{name}</span>
        <span className="mono" style={{ fontSize: 10.5, color: mono }}>{value}</span>
      </div>
    </div>
  );
}
