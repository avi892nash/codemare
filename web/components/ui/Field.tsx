'use client';

import type { CSSProperties, MutableRefObject, ReactNode, Ref, RefCallback } from 'react';
import { Icon } from './Icon';
import s from './Field.module.css';

/** Combine a forwarded ref with a local one. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(value);
      else if (ref) (ref as MutableRefObject<T | null>).current = value;
    }
  };
}

export interface FieldMessageProps {
  /** Visible label, wired to the control with htmlFor. */
  label?: ReactNode;
  /** Help text under the control (aria-describedby). */
  hint?: ReactNode;
  /** `true` marks the control invalid; a node also renders it as the message. */
  error?: ReactNode | boolean;
  required?: boolean;
}

/** ids + aria wiring shared by Input, Textarea and Select. */
export function fieldAria(id: string, { hint, error }: FieldMessageProps, describedBy?: string) {
  const errorText = typeof error === 'boolean' ? null : error;
  const messageId = errorText != null ? `${id}-error` : hint != null ? `${id}-hint` : null;
  return {
    errorText,
    invalid: !!error,
    describedBy: [describedBy, messageId].filter(Boolean).join(' ') || undefined,
  };
}

export function hasFrame({ label, hint, error }: FieldMessageProps): boolean {
  return label != null || hint != null || (error != null && typeof error !== 'boolean');
}

/**
 * Label + control + message column. Rendered only when a label, hint or
 * error message is present, so bare controls keep their old single-element
 * DOM (and their className/style).
 */
export function FieldFrame({
  id, label, hint, error, required, full, className, style, children,
}: FieldMessageProps & { id: string; full?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  const errorText = typeof error === 'boolean' ? null : error;
  return (
    <div className={[s.field, full && s.full, className].filter(Boolean).join(' ')} style={style}>
      {label != null && (
        <label htmlFor={id} className={s.label}>
          {label}
          {required && <span aria-hidden="true" className={s.required}>*</span>}
        </label>
      )}
      {children}
      {errorText != null ? (
        <p id={`${id}-error`} className={s.error}>
          <Icon name="alert-circle" size={12} />
          <span>{errorText}</span>
        </p>
      ) : hint != null ? (
        <p id={`${id}-hint`} className={s.hint}>{hint}</p>
      ) : null}
    </div>
  );
}

export { s as fieldStyles };
