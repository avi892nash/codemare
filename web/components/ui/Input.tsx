'use client';

import type { CSSProperties, ChangeEvent } from 'react';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Kbd';

interface InputProps {
  icon?: IconName;
  kbd?: string;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: CSSProperties;
  full?: boolean;
}

const HEIGHTS: Record<'sm' | 'md' | 'lg', number> = { sm: 28, md: 32, lg: 38 };

export function Input({
  icon, kbd, value, onChange, placeholder, type = 'text', size = 'md',
  className = '', style, full,
}: InputProps) {
  return (
    <label
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: HEIGHTS[size],
        padding: '0 10px',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r)',
        width: full ? '100%' : 'auto',
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={14} style={{ color: 'var(--fg-3)' }} />}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--fg-0)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          flex: 1,
          width: full ? '100%' : 180,
        }}
      />
      {kbd && <Kbd>{kbd}</Kbd>}
    </label>
  );
}
