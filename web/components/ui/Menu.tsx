'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';
import s from './Menu.module.css';

export type MenuItem =
  | { kind: 'link'; label: string; href: string; icon?: IconName; description?: string; meta?: ReactNode; current?: boolean }
  | { kind: 'action'; label: string; onSelect: () => void; icon?: IconName; description?: string; tone?: 'default' | 'danger'; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'label'; label: string };

export interface DropdownMenuProps {
  /** Visible trigger content (avatar, label + chevron…). */
  trigger: ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  items: MenuItem[];
  /** Non-interactive block above the items (e.g. a profile card). */
  header?: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  className?: string;
}

function itemsIn(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
}

function focusItem(menu: HTMLElement | null, i: number) {
  const list = itemsIn(menu);
  if (list.length) list[(i + list.length) % list.length].focus();
}

/**
 * Menu button (WAI-ARIA APG): Enter/Space/↓ open on the first item, ↑ on the
 * last; ↑/↓/Home/End move, letters jump, Esc closes back to the trigger, Tab
 * or an outside click closes. Items are links (next/link) or actions.
 */
export function DropdownMenu({
  trigger, label, items, header, align = 'end', width = 232, triggerClassName, triggerStyle, className,
}: DropdownMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<'first' | 'last' | null>(null);

  const menuItems = () => itemsIn(menuRef.current);
  const focusAt = (i: number) => focusItem(menuRef.current, i);

  const openMenu = (focus: 'first' | 'last') => {
    pendingFocus.current = focus;
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    if (pendingFocus.current) {
      focusItem(menuRef.current, pendingFocus.current === 'first' ? 0 : -1);
      pendingFocus.current = null;
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu('first');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu('last');
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    const i = list.indexOf(document.activeElement as HTMLElement);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(i + 1); return;
      case 'ArrowUp': e.preventDefault(); focusAt(i - 1); return;
      case 'Home': e.preventDefault(); focusAt(0); return;
      case 'End': e.preventDefault(); focusAt(-1); return;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); return;
      case 'Tab': setOpen(false); return;
      case ' ':
        // Space activates links too (native only does Enter).
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.click();
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const ch = e.key.toLowerCase();
          const order = [...list.slice(i + 1), ...list.slice(0, i + 1)];
          order.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch))?.focus();
        }
    }
  };

  return (
    <div ref={rootRef} className={[s.root, className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        className={[s.trigger, 'focus-ring', triggerClassName].filter(Boolean).join(' ')}
        style={triggerStyle}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKey}
      >
        {trigger}
      </button>
      {open && (
        <div className={`${s.popover} ${align === 'end' ? s.end : s.start}`} style={{ width }}>
          {header && <div className={s.header}>{header}</div>}
          <div id={menuId} ref={menuRef} role="menu" aria-label={label} className={s.menu} onKeyDown={onMenuKey}>
            {items.map((item, k) => {
              if (item.kind === 'separator') return <div key={`sep-${k}`} role="separator" className={s.separator} />;
              if (item.kind === 'label') return <div key={`lbl-${k}`} role="presentation" className={s.groupLabel}>{item.label}</div>;
              const body = (
                <>
                  {item.icon && <Icon name={item.icon} size={14} />}
                  <span className={s.itemText}>
                    <span>{item.label}</span>
                    {item.description && <span className={s.itemDesc}>{item.description}</span>}
                  </span>
                  {item.kind === 'link' && item.meta != null && <span className={s.itemMeta}>{item.meta}</span>}
                </>
              );
              if (item.kind === 'link') {
                return (
                  <Link
                    key={`${item.href}-${k}`}
                    href={item.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={item.current ? 'page' : undefined}
                    className={s.item}
                    onClick={() => setOpen(false)}
                  >
                    {body}
                  </Link>
                );
              }
              return (
                <button
                  key={`${item.label}-${k}`}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={item.disabled || undefined}
                  className={[s.item, item.tone === 'danger' && s.danger].filter(Boolean).join(' ')}
                  onClick={() => {
                    if (item.disabled) return;
                    close(true);
                    item.onSelect();
                  }}
                >
                  {body}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
