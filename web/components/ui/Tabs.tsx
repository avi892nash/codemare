'use client';

interface TabItem { value: string; label: string; count?: number }

export interface TabsProps {
  tabs: Array<string | TabItem>;
  value: string;
  onChange?: (v: string) => void;
  variant?: 'underline' | 'pills';
  size?: 'sm' | 'md';
}

export function Tabs({ tabs, value, onChange, variant = 'underline', size = 'md' }: TabsProps) {
  if (variant === 'pills') {
    return (
      <div
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 3,
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r)',
        }}
      >
        {tabs.map((t) => {
          const k = typeof t === 'string' ? t : t.value;
          const lbl = typeof t === 'string' ? t : t.label;
          const active = k === value;
          return (
            <button
              key={k}
              onClick={() => onChange?.(k)}
              style={{
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 4,
                border: 'none',
                background: active ? 'var(--bg-4)' : 'transparent',
                color: active ? 'var(--fg-0)' : 'var(--fg-2)',
                cursor: 'pointer',
              }}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--line-2)' }}>
      {tabs.map((t) => {
        const k = typeof t === 'string' ? t : t.value;
        const lbl = typeof t === 'string' ? t : t.label;
        const cnt = typeof t === 'object' ? t.count : null;
        const active = k === value;
        return (
          <button
            key={k}
            onClick={() => onChange?.(k)}
            style={{
              padding: size === 'sm' ? '8px 12px' : '10px 14px',
              fontSize: size === 'sm' ? 12 : 13,
              fontWeight: 500,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: active ? 'var(--fg-0)' : 'var(--fg-2)',
              borderBottom: active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
              marginBottom: -1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {lbl}
            {cnt != null && <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>{cnt}</span>}
          </button>
        );
      })}
    </div>
  );
}
