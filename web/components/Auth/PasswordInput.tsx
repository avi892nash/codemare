'use client';

import { forwardRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, type InputProps } from '@/components/ui/Input';

/**
 * The kit's Input with a show/hide toggle inside the box. The toggle is a
 * pressed-state button ("Show password", aria-pressed), so its name never
 * changes under a screen reader.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'trailing'>>(
  function PasswordInput(props, ref) {
    const [shown, setShown] = useState(false);
    return (
      <Input
        {...props}
        ref={ref}
        type={shown ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        trailing={
          <Button
            variant="ghost"
            size="sm"
            tap
            icon={shown ? 'eye-off' : 'eye'}
            aria-label="Show password"
            aria-pressed={shown}
            disabled={props.disabled}
            onClick={() => setShown((v) => !v)}
          />
        }
      />
    );
  }
);
