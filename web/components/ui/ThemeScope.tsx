import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { themeClassName, type Theme } from '@/lib/theme';

interface ThemeScopeProps extends Omit<HTMLAttributes<HTMLElement>, 'className' | 'style'> {
  theme: Theme;
  as?: 'div' | 'section' | 'main' | 'aside' | 'span';
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Pins a subtree to one theme regardless of the user's choice — used by
 * /dev/system to show both themes side by side, and handy for marketing
 * panels that are always dark. Re-sets `color` and `background` because both
 * would otherwise resolve against the parent theme. Portals (Tooltip, Modal)
 * opened from inside a scope inherit it via the `data-theme` attribute.
 */
export function ThemeScope({ theme, as: Tag = 'div', className = '', style, children, ...rest }: ThemeScopeProps) {
  return (
    <Tag
      {...rest}
      data-theme={theme}
      className={`${themeClassName(theme)} ${className}`.trim()}
      style={{ color: 'var(--fg-0)', background: 'var(--bg-0)', ...style }}
    >
      {children}
    </Tag>
  );
}
