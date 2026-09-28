'use client';

import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Tabs.module.css';

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Array<string | TabItem>;
  value: string;
  onChange?: (v: string) => void;
  variant?: 'underline' | 'pills';
  size?: 'sm' | 'md';
  /**
   * Base id. When set, tabs get `id`s and the selected one points at its
   * <TabPanel tabsId={id} value=…> with aria-controls.
   */
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** automatic (default): arrows select. manual: arrows move focus, Enter/Space select. */
  activation?: 'automatic' | 'manual';
  className?: string;
  style?: CSSProperties;
}

const safe = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '_');
export const tabId = (base: string, value: string) => `${base}-tab-${safe(value)}`;
export const tabPanelId = (base: string, value: string) => `${base}-panel-${safe(value)}`;

function normalize(t: string | TabItem): TabItem {
  return typeof t === 'string' ? { value: t, label: t } : t;
}

/**
 * WAI-ARIA tabs: role=tablist/tab, aria-selected, roving tabindex (only the
 * selected tab is in the Tab order), ←/→ with wrap, Home/End, disabled tabs
 * skipped. Variants: underline (section nav) and pills (compact switcher).
 */
export function Tabs({
  tabs, value, onChange, variant = 'underline', size = 'md', id, activation = 'automatic',
  className, style, ...aria
}: TabsProps) {
  const autoId = useId();
  const base = id ?? autoId;
  const items = tabs.map(normalize);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const firstEnabled = items.findIndex((t) => !t.disabled);
  const activeIndex = items.findIndex((t) => t.value === value);
  // If `value` matches nothing, keep the list reachable via the first tab.
  const tabStop = activeIndex >= 0 ? activeIndex : firstEnabled;

  const move = (from: number, dir: 1 | -1 | 'first' | 'last') => {
    const n = items.length;
    let i = -1;
    if (dir === 'first') {
      i = firstEnabled;
    } else if (dir === 'last') {
      for (let k = n - 1; k >= 0; k--) if (!items[k].disabled) { i = k; break; }
    } else {
      for (let step = 1, k = from; step <= n; step++) {
        k = (k + dir + n) % n;
        if (!items[k].disabled) { i = k; break; }
      }
    }
    if (i < 0) return;
    refs.current[i]?.focus();
    if (activation === 'automatic') onChange?.(items[i].value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight': move(index, 1); break;
      case 'ArrowLeft': move(index, -1); break;
      case 'Home': move(index, 'first'); break;
      case 'End': move(index, 'last'); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={[variant === 'pills' ? s.pills : s.underline, size === 'sm' && s.sm, className].filter(Boolean).join(' ')}
      style={style}
      {...aria}
    >
      {items.map((t, index) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="tab"
            id={id ? tabId(base, t.value) : undefined}
            aria-selected={active}
            aria-controls={id && active ? tabPanelId(base, t.value) : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={t.disabled}
            className={`${s.tab} focus-ring`}
            onClick={() => onChange?.(t.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {t.icon && <Icon name={t.icon} size={size === 'sm' ? 12 : 13} />}
            {t.label}
            {/* The space keeps the accessible name "Submissions 12", not "Submissions12". */}
            {t.count != null && <>{' '}<span className={s.count}>{t.count}</span></>}
          </button>
        );
      })}
    </div>
  );
}

/** The panel for one tab; pair with <Tabs id={tabsId}>. Focusable per APG. */
export function TabPanel({
  tabsId, value, children, className, style,
}: { tabsId: string; value: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      tabIndex={0}
      className={`focus-ring ${className ?? ''}`.trim()}
      style={style}
    >
      {children}
    </div>
  );
}
