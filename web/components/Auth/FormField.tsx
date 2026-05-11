'use client';

import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';

const inputStyle: CSSProperties = {
  height: 38,
  padding: '0 12px',
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 6,
  color: 'var(--fg-0)',
  fontSize: 13.5,
  fontFamily: 'var(--font-sans)',
  outline: 'none',
  width: '100%',
};

/* Label + input + optional right-side adornment + optional hint.
 * Auth form uses this for every field. */
export function FormField({
  label,
  hint,
  right,
  children,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg-2)' }}>
        {label}
        <span style={{ flex: 1 }} />
        {right}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{hint}</span>}
    </label>
  );
}

export function AuthInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{ ...inputStyle, ...(props.style ?? {}) }} />;
}

export const authLinkStyle: CSSProperties = {
  color: 'var(--accent-hi)',
  textDecoration: 'none',
  fontWeight: 500,
  cursor: 'pointer',
};
