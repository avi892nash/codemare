'use client';

import { forwardRef, useId, type CSSProperties, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import { FieldFrame, fieldAria, fieldStyles as s, hasFrame, type FieldMessageProps } from './Field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends FieldMessageProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'className' | 'style'> {
  /** Strings are value = label. Or pass <option> children. */
  options?: Array<SelectOption | string>;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Disabled first option shown while nothing is chosen (value ""). */
  placeholder?: string;
  full?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Styled native <select>: keyboard, typeahead, mobile pickers and screen
 * readers all come for free. The option list follows the theme via
 * `color-scheme` on `.cm` / `.cm-light`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    options, children, size = 'md', icon, placeholder, full, className, style, label, hint, error, required,
    id: idProp, disabled, 'aria-describedby': describedByProp, ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const { invalid, describedBy } = fieldAria(id, { hint, error }, describedByProp);
  const framed = hasFrame({ label, hint, error });

  const box = (
    <div
      className={[s.control, s.selectControl, s[size], full && s.full, !framed && className].filter(Boolean).join(' ')}
      style={framed ? undefined : style}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
    >
      {icon && <Icon name={icon} size={14} className={s.icon} />}
      <select
        ref={ref}
        id={id}
        disabled={disabled}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={s.select}
        {...rest}
      >
        {placeholder != null && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>{o}</option>
          ) : (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ),
        )}
        {children}
      </select>
      <Icon name="chev-down" size={13} className={s.chevron} />
    </div>
  );

  if (!framed) return box;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} required={required} full={full} className={className} style={style}>
      {box}
    </FieldFrame>
  );
});
