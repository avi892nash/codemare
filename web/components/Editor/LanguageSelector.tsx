'use client';

import type { Language } from '@/lib/types';
import { LangMark } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
];

export function LanguageSelector({
  value,
  onChange,
}: {
  value: Language;
  onChange: (l: Language) => void;
}) {
  const current = LANGUAGES.find((l) => l.value === value);
  return (
    <label
      className="focus-ring"
      style={{
        height: 32,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r)',
        color: 'var(--fg-0)',
        fontSize: 13,
        cursor: 'pointer',
      }}
    >
      <LangMark lang={current?.label ?? 'Python'} size={14} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Language)}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--fg-0)',
          fontSize: 13,
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 14,
          cursor: 'pointer',
        }}
      >
        {LANGUAGES.map((l) => (
          <option key={l.value} value={l.value} style={{ background: 'var(--bg-2)' }}>
            {l.label}
          </option>
        ))}
      </select>
      <Icon name="chev-down" size={13} style={{ color: 'var(--fg-3)', marginLeft: -10, pointerEvents: 'none' }} />
    </label>
  );
}
