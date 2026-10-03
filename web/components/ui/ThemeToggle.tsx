'use client';

import { Button, type ButtonSize } from './Button';
import { Tooltip } from './Tooltip';
import { useTheme } from './ThemeProvider';

/**
 * Sun / moon button that flips dark ⇄ light in place (class on <html> +
 * `cm-theme` cookie, no reload). `withLabel` adds the text for menus; `tap`
 * makes it a 44 px target on phones and touch devices (the top bar).
 */
export function ThemeToggle({ size = 'sm', withLabel = false, tap = false }: { size?: ButtonSize; withLabel?: boolean; tap?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  const button = (
    <Button
      variant="ghost"
      size={size}
      tap={tap}
      icon={theme === 'dark' ? 'sun' : 'moon'}
      aria-label={withLabel ? undefined : label}
      onClick={toggleTheme}
    >
      {withLabel ? (next === 'light' ? 'Light theme' : 'Dark theme') : undefined}
    </Button>
  );
  return withLabel ? button : <Tooltip content={label}>{button}</Tooltip>;
}
