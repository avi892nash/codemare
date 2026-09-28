'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Chip.module.css';

interface ChipProps {
  children: ReactNode;
  /** Pressed state for filter toggles (renders aria-pressed). */
  selected?: boolean;
  /** Makes the chip a toggle button. Omit for a static chip. */
  onToggle?: (next: boolean) => void;
  /** Result count shown after the label (mono). */
  count?: number;
  /** Adds a trailing ✕ button; `onRemove` is required with it. */
  removable?: boolean;
  onRemove?: () => void;
  /** Accessible name of the ✕ button; defaults to "Remove <label>". */
  removeLabel?: string;
  icon?: IconName;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Filter chip. Three shapes: static label; toggle (`onToggle`, `selected`,
 * `aria-pressed`); removable (active-filter token with its own ✕ button —
 * two sibling buttons, never a button inside a button).
 */
export function Chip({
  children, selected = false, onToggle, count, removable = false, onRemove, removeLabel,
  icon, size = 'md', disabled = false, className, style,
}: ChipProps) {
  const label = (
    <>
      {icon && <Icon name={icon} size={12} />}
      {children}
      {count != null && <>{' '}<span className={s.count}>{count}</span></>}
    </>
  );
  const plainText = typeof children === 'string' ? children : 'filter';

  return (
    <span
      className={[s.chip, size === 'sm' && s.sm, removable && s.hasRemove, className].filter(Boolean).join(' ')}
      data-selected={selected || undefined}
      data-disabled={disabled || undefined}
      style={style}
    >
      {onToggle ? (
        <button
          type="button"
          className={`${s.main} focus-ring`}
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => onToggle(!selected)}
        >
          {label}
        </button>
      ) : (
        <span className={`${s.main} ${s.static}`}>{label}</span>
      )}
      {removable && (
        <button
          type="button"
          className={`${s.remove} focus-ring`}
          aria-label={removeLabel ?? `Remove ${plainText}`}
          disabled={disabled}
          onClick={() => onRemove?.()}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}
