'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCountdown } from '@/lib/client/format';
import type { GateContext } from './types';
import s from './Workspace.module.css';

interface GateBannerProps {
  gate: GateContext;
  currentSlug?: string;
  /** Slugs solved in this attempt (updates live after an accepted gate submit). */
  solved: ReadonlySet<string>;
  onExpire: () => void;
}

const WARN_MS = 5 * 60_000;

/**
 * The gate strip over the workspace: countdown to the attempt's deadline,
 * progress against the pass threshold, and the other gate questions. The
 * countdown renders after mount (server and browser clocks differ) and
 * announces 5 min, 1 min and time's up to screen readers.
 *
 * On a desktop it is one row with everything in it. Below 1024 px it is one
 * 44 px line — the clock and "1/4 · pass with 3" — with a button at its end
 * that opens the rest (the gate's name, a way back to it and its problems,
 * each a 44 px row): the strip used to be 126 px tall, which is the height of
 * the editor it left out.
 */
export function GateBanner({ gate, currentSlug, solved, onExpire }: GateBannerProps) {
  const deadline = new Date(gate.deadlineAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [open, setOpen] = useState(false);
  const moreId = useId();
  const spoken = useRef(new Set<string>());
  const expired = now != null && now >= deadline;
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (now == null) return;
    const left = deadline - now;
    const say = (key: string, text: string) => {
      if (spoken.current.has(key)) return;
      spoken.current.add(key);
      setAnnounce(text);
    };
    if (left <= 0) {
      say('0', 'Time is up. This gate attempt has ended.');
      onExpireRef.current();
    } else if (left <= 60_000) say('1', 'One minute left in the gate attempt.');
    else if (left <= WARN_MS) say('5', 'Five minutes left in the gate attempt.');
  }, [now, deadline]);

  const solvedCount = gate.questions.filter((q) => solved.has(q.slug)).length;
  const passing = solvedCount >= gate.passThreshold;
  const tone = expired ? 'err' : now != null && deadline - now <= WARN_MS ? 'warn' : 'accent';

  return (
    <div className={s.gate} data-tone={tone} data-open={open || undefined} role="region" aria-label="Gate attempt" data-testid="gate-banner">
      <span className={s.gateIcon} aria-hidden="true">
        <Icon name="shield" size={15} />
      </span>
      <div className={s.gateMain}>
        <span className={s.gateTitle}>{gate.title}</span>
        <span className={s.gateMeta}>
          {solvedCount} of {gate.questions.length} solved · pass with {gate.passThreshold}
          {passing && <span className={s.gatePass}> · passing</span>}
        </span>
        {/* the same, short enough for one line on a phone (the other is not shown there, so it is read once) */}
        <span className={s.gateShort}>
          {solvedCount}/{gate.questions.length} · {passing ? <span className={s.gatePass}>passing</span> : `pass with ${gate.passThreshold}`}
        </span>
      </div>
      <div className={s.gateClock}>
        <Icon name="clock" size={13} />
        <span className="mono" aria-label={expired ? 'Time is up' : 'Time left'} data-testid="gate-countdown">
          {now == null ? '–:––' : expired ? 'Time’s up' : formatCountdown(deadline - now)}
        </span>
      </div>
      <button type="button" className={`${s.gateToggle} focus-ring`} aria-expanded={open} aria-controls={moreId} aria-label="Gate problems" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={16} />
      </button>
      <nav id={moreId} className={s.gateQuestions} aria-label="Gate questions">
        {gate.questions.map((q, i) => (
          <Link
            key={q.slug}
            href={`/problems/${q.slug}?attempt=${encodeURIComponent(gate.attemptId)}`}
            className={`${s.gateQ} focus-ring`}
            aria-current={q.slug === currentSlug ? 'page' : undefined}
            data-solved={solved.has(q.slug) || undefined}
            title={q.title}
          >
            {solved.has(q.slug) ? <Icon name="check" size={11} /> : <span className="mono">{i + 1}</span>}
            <span className={s.gateQTitle}>{q.title}</span>
          </Link>
        ))}
      </nav>
      <ButtonLink href={gate.backHref} size="xs" variant="ghost" iconRight="arrow-right" className={s.gateBack}>
        {expired ? 'See result' : 'Gate'}
      </ButtonLink>
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
