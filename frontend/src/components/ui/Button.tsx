import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Kbd';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'outline' | 'danger' | 'success' | 'accent';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  kbd?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  disabled?: boolean;
  full?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

const HEIGHTS: Record<ButtonSize, number> = { xs: 22, sm: 28, md: 32, lg: 38 };
const PX:      Record<ButtonSize, number> = { xs:  8, sm: 10, md: 12, lg: 16 };
const FS:      Record<ButtonSize, number> = { xs: 11, sm: 12, md: 13, lg: 14 };

const VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--accent)',     color: '#0b0a14',           borderColor: 'var(--accent)' },
  default: { background: 'var(--bg-2)',       color: 'var(--fg-0)',       borderColor: 'var(--line-2)' },
  ghost:   { background: 'transparent',       color: 'var(--fg-1)',       borderColor: 'transparent' },
  outline: { background: 'transparent',       color: 'var(--fg-0)',       borderColor: 'var(--line-3)' },
  danger:  { background: 'var(--err-bg)',     color: 'var(--err)',        borderColor: 'color-mix(in oklab, var(--err) 30%, transparent)' },
  success: { background: 'var(--ok-bg)',      color: 'var(--ok)',         borderColor: 'color-mix(in oklab, var(--ok) 30%, transparent)' },
  accent:  { background: 'var(--accent-bg)',  color: 'var(--accent-hi)',  borderColor: 'var(--accent-line)' },
};

export function Button({
  children, variant = 'default', size = 'md', icon, iconRight, kbd,
  className = '', style, onClick, disabled, full, type = 'button', title,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`focus-ring ${className}`}
      style={{
        height: HEIGHTS[size],
        padding: `0 ${PX[size]}px`,
        fontSize: FS[size],
        fontWeight: 500,
        fontFamily: 'var(--font-sans)',
        borderRadius: 'var(--r)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: '1px solid transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background .12s, border-color .12s, color .12s',
        whiteSpace: 'nowrap',
        width: full ? '100%' : 'auto',
        justifyContent: full ? 'center' : 'flex-start',
        opacity: disabled ? 0.5 : 1,
        ...VARIANTS[variant],
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={size === 'xs' ? 11 : size === 'lg' ? 16 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'xs' ? 11 : 14} />}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}
