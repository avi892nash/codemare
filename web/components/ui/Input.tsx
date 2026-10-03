'use client';

import {
  forwardRef,
  useId,
  useMemo,
  useRef,
  type CSSProperties,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './Icon';
import { Kbd } from './Kbd';
import { FieldFrame, fieldAria, fieldStyles as s, hasFrame, mergeRefs, type FieldMessageProps } from './Field';

type ControlSize = 'sm' | 'md' | 'lg';

export interface InputProps
  extends FieldMessageProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className' | 'style' | 'prefix'> {
  icon?: IconName;
  /** Shortcut hint shown at the right edge (decorative; aria-hidden). */
  kbd?: string;
  size?: ControlSize;
  /** Applied to the outermost element (the field column when framed). */
  className?: string;
  style?: CSSProperties;
  full?: boolean;
  /** Extra content at the right edge inside the box, e.g. a clear button. */
  trailing?: ReactNode;
  inputClassName?: string;
  inputStyle?: CSSProperties;
}

/** Clicking the box (icon, padding) focuses the input, but not its buttons. */
function focusOnBoxClick(target: HTMLInputElement | HTMLTextAreaElement | null, disabled?: boolean) {
  return (e: MouseEvent<HTMLDivElement>) => {
    if (!target || disabled || e.target === target) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    target.focus();
  };
}

/**
 * Text input. Bare by default (icon · input · kbd in one box); pass `label`,
 * `hint` or `error` to get the labelled field with aria-describedby /
 * aria-invalid wired up. Always give it a `label` or an `aria-label`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    icon, kbd, size = 'md', className, style, full, label, hint, error, required, trailing,
    inputClassName, inputStyle, id: idProp, type = 'text', disabled, 'aria-describedby': describedByProp, ...rest
  },
  ref,
) {
  const inner = useRef<HTMLInputElement | null>(null);
  const setRef = useMemo(() => mergeRefs(ref, inner), [ref]);
  const autoId = useId();
  const id = idProp ?? autoId;
  const { invalid, describedBy } = fieldAria(id, { hint, error }, describedByProp);
  const framed = hasFrame({ label, hint, error });

  const box = (
    <div
      className={[s.control, s[size], full && s.full, !framed && className].filter(Boolean).join(' ')}
      style={framed ? undefined : style}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      onMouseDown={(e) => focusOnBoxClick(inner.current, disabled)(e)}
    >
      {icon && <Icon name={icon} size={14} className={s.icon} />}
      <input
        ref={setRef}
        id={id}
        type={type}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={[s.input, inputClassName].filter(Boolean).join(' ')}
        style={inputStyle}
        {...rest}
      />
      {trailing}
      {kbd && <span aria-hidden="true" className={s.kbdWrap}><Kbd>{kbd}</Kbd></span>}
    </div>
  );

  if (!framed) return box;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} required={required} full={full} className={className} style={style}>
      {box}
    </FieldFrame>
  );
});

export interface TextareaProps
  extends FieldMessageProps,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'style'> {
  /** Monospace text — stdin, test input, code-ish content. */
  mono?: boolean;
  full?: boolean;
  className?: string;
  style?: CSSProperties;
  textareaStyle?: CSSProperties;
}

/** Multi-line sibling of Input with the same field wiring. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    mono, full = true, className, style, textareaStyle, label, hint, error, required, id: idProp, disabled,
    'aria-describedby': describedByProp, ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const { invalid, describedBy } = fieldAria(id, { hint, error }, describedByProp);
  const framed = hasFrame({ label, hint, error });

  const box = (
    <div
      className={[s.control, s.multiline, full && s.full, !framed && className].filter(Boolean).join(' ')}
      style={framed ? undefined : style}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
    >
      <textarea
        ref={ref}
        id={id}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={[s.textarea, mono && s.mono].filter(Boolean).join(' ')}
        style={textareaStyle}
        spellCheck={mono ? false : rest.spellCheck}
        {...rest}
      />
    </div>
  );

  if (!framed) return box;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} required={required} full={full} className={className} style={style}>
      {box}
    </FieldFrame>
  );
});
