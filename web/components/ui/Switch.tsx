'use client';

/* Simple sliding toggle. Indigo accent when on. */
export function Switch({ checked, onChange }: { checked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange?.(!checked)}
      className="focus-ring"
      style={{
        width: 30,
        height: 18,
        borderRadius: 999,
        position: 'relative',
        border: '1px solid var(--line-2)',
        background: checked ? 'var(--accent)' : 'var(--bg-3)',
        cursor: 'pointer',
        transition: 'background .12s',
        padding: 0,
      }}
      aria-pressed={checked}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: checked ? 13 : 1,
          width: 14,
          height: 14,
          borderRadius: 999,
          background: '#fff',
          transition: 'left .15s',
          boxShadow: '0 1px 2px rgba(0,0,0,.3)',
        }}
      />
    </button>
  );
}
