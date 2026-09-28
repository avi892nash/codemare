'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icon';

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

/**
 * "Copy" text button with a "Copied" confirmation that is also announced to
 * screen readers (polite live region).
 */
export function CopyButton({
  text, label = 'Copy', copiedLabel = 'Copied', ariaLabel = 'Copy code', style,
}: { text: string; label?: string; copiedLabel?: string; ariaLabel?: string; style?: CSSProperties }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      <button
        type="button"
        className="focus-ring"
        aria-label={ariaLabel}
        onClick={async () => {
          try {
            await writeClipboard(text);
            setCopied(true);
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard blocked — nothing sensible to do */
          }
        }}
        style={{
          background: 'transparent',
          border: 'none',
          color: copied ? 'var(--ok-fg)' : 'var(--fg-2)',
          cursor: 'pointer',
          fontSize: 11,
          fontFamily: 'var(--font-sans)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 4px',
          borderRadius: 4,
          ...style,
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={12} />
        {copied ? copiedLabel : label}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </>
  );
}
