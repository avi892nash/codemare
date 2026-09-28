'use client';

import { useEffect, useRef, useState } from 'react';
import { formatCountdown } from '@/lib/client/format';
import s from './loop.module.css';

export interface CountdownProps {
  /** ISO timestamp to count down to. */
  to: string;
  /**
   * Called shortly after the time is reached (the server's clock may trail
   * the browser's), then every 15 s while still expired — typically a
   * `router.refresh()` so the server can settle the state.
   */
  onExpire?: () => void;
  /** Shown once the time is up. */
  expiredText?: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * A live `h:mm:ss` countdown. Renders a placeholder until mounted — server
 * and browser clocks differ, so the first paint never guesses. role=timer
 * keeps screen readers from announcing every tick.
 */
export function Countdown({ to, onExpire, expiredText = '0:00', className, 'data-testid': testId }: CountdownProps) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const expired = now != null && target - now <= 0;
  useEffect(() => {
    if (!expired) return;
    const first = window.setTimeout(() => onExpireRef.current?.(), 1500);
    const again = window.setInterval(() => onExpireRef.current?.(), 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
    };
  }, [expired, to]);

  return (
    <span role="timer" className={[s.timer, 'mono', className].filter(Boolean).join(' ')} data-testid={testId}>
      {now == null ? '–:––' : expired ? expiredText : formatCountdown(target - now)}
    </span>
  );
}

const DATE_TIME: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

/**
 * A timestamp in the viewer's time zone. The server renders it in UTC; the
 * browser swaps in local time after mount (no hydration mismatch).
 */
export function LocalTime({ iso, options = DATE_TIME }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(new Date(iso).toLocaleString(undefined, options));
  }, [iso, options]);
  return (
    <time dateTime={iso}>
      {local ?? `${new Date(iso).toLocaleString('en-US', { ...options, timeZone: 'UTC' })} UTC`}
    </time>
  );
}
