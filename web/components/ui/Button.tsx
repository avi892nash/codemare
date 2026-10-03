'use client';

import Link from 'next/link';
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Kbd';
import { Spinner } from './Spinner';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'outline' | 'danger' | 'success' | 'accent';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonLookProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: IconName;
  iconRight?: IconName;
  /** Shortcut hint rendered as a trailing <Kbd>. */
  kbd?: string;
  /** Stretch to the container width, content centered. */
  full?: boolean;
  /** Grow to a 44 px touch target on phones and touch devices (the look stays the same on a desktop). */
  tap?: boolean;
  /** Shows a spinner and ignores clicks (stays focusable; sets aria-busy). */
  loading?: boolean;
}

export interface ButtonProps
  extends ButtonLookProps,
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'> {
  type?: 'button' | 'submit' | 'reset';
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export interface ButtonLinkProps extends ButtonLookProps, Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
}

/* Icons sit beside text set at 12 px (xs, sm), 13 px (md) and 14 px (lg). */
function iconSizeFor(size: ButtonSize) {
  return size === 'xs' ? 12 : size === 'lg' ? 16 : 14;
}

function classFor(
  variant: ButtonVariant, size: ButtonSize, full: boolean | undefined, iconOnly: boolean, tap: boolean | undefined, extra?: string,
) {
  return [s.btn, s[variant], s[size], iconOnly && s.iconOnly, full && s.full, tap && s.tap, 'focus-ring', extra]
    .filter(Boolean)
    .join(' ');
}

function warnUnlabelled(iconOnly: boolean, props: { 'aria-label'?: string; 'aria-labelledby'?: string; title?: string }) {
  if (process.env.NODE_ENV === 'production' || !iconOnly) return;
  if (!props['aria-label'] && !props['aria-labelledby'] && !props.title) {
    console.warn('[Button] icon-only buttons need an aria-label (or title) so screen readers can name them.');
  }
}

function Content({
  size, icon, iconRight, kbd, loading, children,
}: Pick<ButtonLookProps, 'icon' | 'iconRight' | 'kbd' | 'loading'> & { size: ButtonSize; children?: ReactNode }) {
  const iz = iconSizeFor(size);
  const inner = (
    <>
      {icon && (loading ? <Spinner size={iz} /> : <Icon name={icon} size={iz} />)}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'xs' ? 12 : 14} />}
      {kbd && <Kbd className={s.kbd}>{kbd}</Kbd>}
    </>
  );
  // No leading icon to swap: keep the label's width, overlay the spinner.
  if (loading && !icon) {
    return (
      <>
        <span className={s.label} data-hidden="true">{inner}</span>
        <span className={s.spinnerOverlay}><Spinner size={iz} /></span>
      </>
    );
  }
  return inner;
}

/**
 * The one button. Variants: primary · default · ghost · outline · danger ·
 * success · accent; sizes xs · sm · md · lg. Icon-only buttons (no children)
 * render square and must carry an `aria-label`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children, variant = 'default', size = 'md', icon, iconRight, kbd, full, tap, loading = false,
    className, type = 'button', onClick, disabled, ...rest
  },
  ref,
) {
  const iconOnly = children == null && !!(icon || iconRight);
  warnUnlabelled(iconOnly, rest);
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={classFor(variant, size, full, iconOnly, tap, className)}
      data-variant={variant}
      {...rest}
    >
      <Content size={size} icon={icon} iconRight={iconRight} kbd={kbd} loading={loading}>
        {children}
      </Content>
    </button>
  );
});

/**
 * A `next/link` styled exactly like <Button>. Use for navigation (it renders
 * an <a>, so middle-click / open-in-new-tab work); use <Button> for actions.
 */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  {
    children, href, prefetch, replace, scroll, variant = 'default', size = 'md', icon, iconRight, kbd, full, tap,
    loading = false, className, ...rest
  },
  ref,
) {
  const iconOnly = children == null && !!(icon || iconRight);
  warnUnlabelled(iconOnly, rest);
  return (
    <Link
      ref={ref}
      href={href}
      prefetch={prefetch}
      replace={replace}
      scroll={scroll}
      aria-busy={loading || undefined}
      className={classFor(variant, size, full, iconOnly, tap, className)}
      data-variant={variant}
      {...rest}
    >
      <Content size={size} icon={icon} iconRight={iconRight} kbd={kbd} loading={loading}>
        {children}
      </Content>
    </Link>
  );
});
