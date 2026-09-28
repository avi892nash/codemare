'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Theme } from '@/lib/theme';
import { Button } from './Button';
import { focusableWithin, useIsomorphicLayoutEffect } from './hooks';
import { Portal, PortalContainerContext, scopedTheme } from './Portal';

const WIDTH = { sm: 400, md: 520, lg: 720 } as const;

export interface ModalProps {
  open: boolean;
  /** Called on Esc, the ✕ button and (by default) a backdrop click. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action row; put the primary action last. */
  footer?: ReactNode;
  size?: keyof typeof WIDTH;
  /** Use 'alertdialog' for confirmations that interrupt the flow. */
  role?: 'dialog' | 'alertdialog';
  /** Focused on open. Default: first focusable in the body/footer, else the panel. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Default true for dialog, false for alertdialog. */
  closeOnBackdrop?: boolean;
  hideClose?: boolean;
  /** Force a theme; by default it follows the <ThemeScope> of the opener. */
  theme?: Theme;
}

/**
 * Modal dialog: portal, `aria-modal`, labelled by its title, focus trapped
 * (Tab / Shift+Tab cycle inside), Esc closes, focus returns to whatever
 * opened it, page scroll locked and the rest of the page made `inert`.
 */
export function Modal({
  open, onClose, title, description, children, footer, size = 'md', role = 'dialog',
  initialFocusRef, closeOnBackdrop, hideClose = false, theme,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [scoped, setScoped] = useState<Theme | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const setLayerRef = useCallback((el: HTMLDivElement | null) => {
    layerRef.current = el;
    setLayer(el);
  }, []);

  // Remember the opener and its theme before focus moves.
  const openerRef = useRef<HTMLElement | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setScoped(scopedTheme(openerRef.current));
  }, [open]);

  // Focus in, lock scroll, inert the background; undo it all on close.
  useEffect(() => {
    if (!open) return;
    const layerEl = layerRef.current;
    const panel = panelRef.current;
    if (!layerEl || !panel) return;

    let top: HTMLElement = layerEl;
    while (top.parentElement && top.parentElement !== document.body) top = top.parentElement;
    const inerted: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el instanceof HTMLElement && el !== top && !el.inert) {
        el.inert = true;
        inerted.push(el);
      }
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const target =
      initialFocusRef?.current ??
      (bodyRef.current && focusableWithin(bodyRef.current)[0]) ??
      focusableWithin(panel).find((el) => !el.dataset.modalClose) ??
      panel;
    target.focus();

    const opener = openerRef.current;
    return () => {
      inerted.forEach((el) => { el.inert = false; });
      document.body.style.overflow = prevOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const backdropCloses = closeOnBackdrop ?? role === 'dialog';

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusableWithin(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <Portal theme={theme ?? scoped}>
      <div
        ref={setLayerRef}
        onKeyDown={onKeyDown}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
      >
        <div
          aria-hidden
          onMouseDown={() => backdropCloses && onCloseRef.current()}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'color-mix(in oklab, var(--bg-0) 72%, transparent)',
            backdropFilter: 'blur(2px)',
            animation: 'cm-fade-in .14s ease-out',
          }}
        />
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          style={{
            position: 'relative',
            width: `min(${WIDTH[size]}px, 100%)`,
            maxHeight: 'min(85vh, 720px)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-1)',
            color: 'var(--fg-0)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-lg)',
            outline: 'none',
            animation: 'cm-pop-in .16s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 12px 20px' }}>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
              <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, letterSpacing: -0.2, color: 'var(--fg-0)' }}>
                {title}
              </h2>
              {description && (
                <p id={descId} style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--fg-2)' }}>
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <Button
                variant="ghost"
                size="sm"
                icon="close"
                aria-label="Close dialog"
                data-modal-close="true"
                onClick={() => onCloseRef.current()}
              />
            )}
          </div>
          <PortalContainerContext.Provider value={layer}>
            {children != null && (
              <div
                ref={bodyRef}
                className="scroll"
                style={{ padding: '0 20px 18px', overflowY: 'auto', minHeight: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--fg-1)' }}
              >
                {children}
              </div>
            )}
            {footer && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: '12px 16px',
                  borderTop: '1px solid var(--line-2)',
                  background: 'var(--bg-1)',
                  borderRadius: '0 0 var(--r-lg) var(--r-lg)',
                }}
              >
                {footer}
              </div>
            )}
          </PortalContainerContext.Provider>
        </div>
      </div>
    </Portal>
  );
}
