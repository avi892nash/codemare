'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Chip } from '@/components/ui/Chip';
import s from './author.module.css';

export interface TagInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** Applied to each new entry (e.g. kebab-case for tags); '' drops it. */
  normalize: (raw: string) => string;
  placeholder?: string;
  hint?: string;
  max?: number;
  /** Suggestions offered through a <datalist>. */
  suggestions?: string[];
}

/**
 * Chips + a text box: Enter or comma adds, Backspace on an empty box removes
 * the last chip, each chip has its own ✕ button. Duplicates are ignored.
 */
export function TagInput({ label, values, onChange, normalize, placeholder, hint, max = 20, suggestions }: TagInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = useId();

  const commit = (raw: string) => {
    const parts = raw.split(',').map(normalize).filter(Boolean);
    if (parts.length === 0) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(text);
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className={s.fieldset}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      <div className={s.tagBox} onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}>
        {values.map((v) => (
          <Chip key={v} size="sm" removable onRemove={() => onChange(values.filter((x) => x !== v))} removeLabel={`Remove ${v}`}>
            {v}
          </Chip>
        ))}
        <input
          ref={inputRef}
          id={id}
          className={s.tagInput}
          value={text}
          placeholder={values.length >= max ? `Up to ${max}` : placeholder}
          disabled={values.length >= max}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(text)}
          aria-describedby={hint ? `${id}-hint` : undefined}
          list={suggestions?.length ? listId : undefined}
          autoComplete="off"
        />
        {suggestions?.length ? (
          <datalist id={listId}>
            {suggestions.filter((sug) => !values.includes(sug)).map((sug) => (
              <option key={sug} value={sug} />
            ))}
          </datalist>
        ) : null}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={s.help}>
          {hint}
        </p>
      )}
    </div>
  );
}
