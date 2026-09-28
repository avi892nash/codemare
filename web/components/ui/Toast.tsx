'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { themeClassName, type Theme } from '@/lib/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Portal, scopedTheme } from './Portal';

export type ToastTone = 'default' | 'ok' | 'warn' | 'err' | 'info';

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 5000 (err: 8000). */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Reuse an id to replace a toast in place (e.g. "Saving…" → "Saved"). */
  id?: string;
}

export interface ToastApi {
  /** Show a toast; returns its id. A string is shorthand for { title }. */
  toast: (options: ToastOptions | string) => string;
  dismiss: (id?: string) => void;
}

interface ToastRecord extends ToastOptions {
  id: string;
  theme: Theme | null;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Record<ToastTone, { icon: IconName | null; color: string }> = {
  default: { icon: null,           color: 'var(--fg-2)' },
  ok:      { icon: 'check-circle', color: 'var(--ok-fg)' },
  warn:    { icon: 'alert',        color: 'var(--warn-fg)' },
  err:     { icon: 'alert-circle', color: 'var(--err-fg)' },
  info:    { icon: 'info',         color: 'var(--info-fg)' },
};

let counter = 0;

/**
 * Mount once (app/layout.tsx does). Renders the notification stack in a
 * persistent `aria-live="polite"` region (errors use role=alert), bottom-
 * right. Timers pause while the stack is hovered or focused; Esc dismisses
 * the focused toast.
 */
export function ToastProvider({ children, max = 4 }: { children: ReactNode; max?: number }) {
  const [items, setItems] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id?: string) => {
    setItems((prev) => (id ? prev.filter((t) => t.id !== id) : []));
  }, []);

  const toast = useCallback(
    (options: ToastOptions | string) => {
      const o = typeof options === 'string' ? { title: options } : options;
      const id = o.id ?? `t${++counter}`;
      const theme = typeof document !== 'undefined' ? scopedTheme(document.activeElement) : null;
      setItems((prev) => {
        const next = prev.filter((t) => t.id !== id);
        return [...next, { ...o, id, theme }].slice(-max);
      });
      return id;
    },
    [max],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider> (mounted in app/layout.tsx).');
  return ctx;
}

function ToastViewport({ items, onDismiss }: { items: ToastRecord[]; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  return (
    <Portal>
      <section
        aria-label="Notifications"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
        }}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 1100,
          width: 'min(360px, calc(100vw - 32px))',
          pointerEvents: items.length ? 'auto' : 'none',
        }}
      >
        {/* A log, not a list: each toast carries its own status/alert role,
            which a list item may not. */}
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {items.map((t) => (
            <ToastItem key={t.id} item={t} paused={paused} onDismiss={() => onDismiss(t.id)} />
          ))}
        </div>
      </section>
    </Portal>
  );
}

function ToastItem({ item, paused, onDismiss }: { item: ToastRecord; paused: boolean; onDismiss: () => void }) {
  const tone = item.tone ?? 'default';
  const meta = TONE[tone];
  const duration = item.duration ?? (tone === 'err' ? 8000 : 5000);
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    remaining.current = duration;
  }, [duration, item.title, item.description]);

  useEffect(() => {
    if (duration === 0 || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, duration, item.title, item.description]);

  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      aria-atomic="true"
      data-theme={item.theme ?? undefined}
      className={item.theme ? themeClassName(item.theme) : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '11px 10px 11px 12px',
        background: 'var(--bg-2)',
        color: 'var(--fg-0)',
        borderRadius: 'var(--r-md)',
        boxShadow: 'var(--shadow)',
        borderLeft: `2px solid ${tone === 'default' ? 'var(--line-3)' : meta.color}`,
        animation: 'cm-pop-in .16s ease-out',
      }}
    >
      {meta.icon && <Icon name={meta.icon} size={16} style={{ color: meta.color, marginTop: 1 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--fg-0)' }}>{item.title}</div>
        {item.description && (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--fg-2)', marginTop: 2 }}>{item.description}</div>
        )}
        {item.action && (
          <Button
            size="xs"
            variant="accent"
            style={{ marginTop: 8 }}
            onClick={() => {
              item.action?.onClick();
              onDismiss();
            }}
          >
            {item.action.label}
          </Button>
        )}
      </div>
      <Button variant="ghost" size="xs" icon="x" aria-label="Dismiss notification" onClick={onDismiss} />
    </div>
  );
}
