'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import s from './Navbar.module.css';

/**
 * "Jump to problem" command input. ⌘K / Ctrl+K focuses it from anywhere;
 * Enter opens the catalog filtered by the query (`/problems?q=`), Esc clears
 * and leaves.
 */
export function JumpInput() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [mod, setMod] = useState('⌘');

  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod('Ctrl ');
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const el = ref.current;
        if (!el || el.offsetParent === null) return; // hidden at this width
        e.preventDefault();
        el.focus();
        el.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      className={s.jump}
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        router.push(v ? `/problems?q=${encodeURIComponent(v)}` : '/problems');
        ref.current?.blur();
      }}
    >
      <Input
        ref={ref}
        icon="search"
        size="sm"
        placeholder="Jump to problem…"
        aria-label="Jump to problem"
        enterKeyHint="search"
        autoComplete="off"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQ('');
            e.currentTarget.blur();
          }
        }}
        trailing={
          <span aria-hidden="true" className={s.jumpKbd}>
            <Kbd>{`${mod}K`}</Kbd>
          </span>
        }
      />
    </form>
  );
}
