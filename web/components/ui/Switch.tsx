'use client';

import type { CSSProperties, ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange?: (v: boolean) => void;
  /** Visible label; clicking it toggles too. Without it, pass aria-label. */
  label?: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
  style?: CSSProperties;
}

const DIM = {
  sm: { w: 26, h: 16, knob: 12 },
  md: { w: 30, h: 18, knob: 14 },
} as const;

/**
 * Sliding on/off control — `role="switch"` + `aria-checked`, Space/Enter to
 * flip. Indigo accent when on. `Toggle` is the same component.
 */
export function Switch({
  checked, onChange, label, description, disabled = false, size = 'md', id, className, style,
  'aria-label': ariaLabel,
}: SwitchProps) {
  const d = DIM[size];
  const button = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="focus-ring"
      style={{
        width: d.w,
        height: d.h,
        flex: 'none',
        borderRadius: 999,
        position: 'relative',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--line-3)'}`,
        background: checked ? 'var(--accent)' : 'var(--bg-3)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background .12s, border-color .12s',
        padding: 0,
        margin: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: (d.h - 2 - d.knob) / 2,
          left: checked ? d.w - 2 - d.knob - 1 : 1,
          width: d.knob,
          height: d.knob,
          borderRadius: 999,
          background: '#fff',
          transition: 'left .15s',
          boxShadow: '0 1px 2px rgba(0,0,0,.3)',
        }}
      />
    </button>
  );

  if (!label) {
    return className || style ? <span className={className} style={style}>{button}</span> : button;
  }
  return (
    <label
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: description ? 'flex-start' : 'center',
        gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {button}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-1)', fontWeight: 500, lineHeight: `${d.h}px` }}>{label}</span>
        {description && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', lineHeight: 1.45 }}>{description}</span>}
      </span>
    </label>
  );
}

/** Alias — the kit calls it Toggle, the original port called it Switch. */
export const Toggle = Switch;
export type ToggleProps = SwitchProps;
