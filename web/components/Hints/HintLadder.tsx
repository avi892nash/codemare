'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Spinner } from '@/components/ui/Spinner';
import { Markdown } from '@/components/Problem/Markdown';
import type { HintLadder as HintLadderData, HintRung, RevealResult } from '@/lib/server/hints';
import type { HintLevel } from '@/lib/types';
import s from './HintLadder.module.css';

export type HintTargetProp = { questionId: string } | { buildStepId: string };

export interface HintLadderProps {
  target: HintTargetProp;
  /** The ladder as the server loaded it; fetched on mount when absent. */
  initial?: HintLadderData | null;
  /** This problem's tokens are already earned — score costs no longer change anything. */
  solved?: boolean;
  /** After a successful reveal (e.g. to refresh a token balance). */
  onReveal?: (reveal: RevealResult) => void;
}

export const LEVEL_LABEL: Record<HintLevel, string> = {
  nudge: 'Nudge',
  concept: 'Concept',
  pseudo: 'Pseudocode',
  line: 'Key line',
  solution: 'Full solution',
};

const LEVEL_BLURB: Record<HintLevel, string> = {
  nudge: 'A push in the right direction.',
  concept: 'The idea or technique that unlocks it.',
  pseudo: 'The algorithm, step by step.',
  line: 'The line that makes it work.',
  solution: 'A complete, explained solution.',
};

interface Shortfall {
  topicId: string;
  minDifficulty: string;
  need: number;
  have: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Free" · "−25% tokens" · "1 Graphs token". */
export function costLabel(rung: Pick<HintRung, 'costKind' | 'costAmount' | 'tokenTopic'>): string {
  if (rung.costAmount === 0) return 'Free';
  if (rung.costKind === 'score') return `−${rung.costAmount}% tokens`;
  return `${plural(rung.costAmount, `${rung.tokenTopic?.title ?? 'topic'} token`)}`;
}

function costSentence(rung: HintRung, penalty: number, solved: boolean): string {
  if (rung.costAmount === 0) return 'This hint is free.';
  if (rung.costKind === 'token') {
    return `It spends ${plural(rung.costAmount, `${rung.tokenTopic?.title ?? ''} token`)} from your balance (your cheapest ones first).`;
  }
  if (solved) return `It carries a ${rung.costAmount}% score cost, but you've already earned this problem's tokens — so it's free now.`;
  const after = Math.min(100, penalty + rung.costAmount);
  return `The tokens you earn for solving this drop by ${rung.costAmount}% (penalty ${penalty}% → ${after}%).`;
}

function shortageText(shortfalls: Shortfall[], rung: HintRung | null): string {
  if (shortfalls.length === 0) return 'You don’t have enough tokens for this hint.';
  return shortfalls
    .map((f) => {
      const topic = rung?.tokenTopic && rung.tokenTopic.id === f.topicId ? rung.tokenTopic.title : 'topic';
      return `You need ${plural(f.need, `${topic} token`)} but have ${f.have} — ${f.need - f.have} short.`;
    })
    .join(' ');
}

async function readError(res: Response, rung: HintRung | null): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string; shortfalls?: Shortfall[] } | null;
  if (body?.error === 'insufficient_tokens') return shortageText(body.shortfalls ?? [], rung);
  if (body?.error === 'hint_locked') return body.message ?? 'Reveal the earlier hints first.';
  return body?.message ?? `Couldn’t reveal the hint (${res.status}).`;
}

/**
 * The hint ladder: nudge → concept → pseudo → line → solution. Each rung
 * shows its cost before it is revealed, unlocks only after the rung below,
 * and needs an explicit confirmation. Revealed hints render as sanitized
 * markdown; re-viewing is free.
 */
export function HintLadder({ target, initial, solved = false, onReveal }: HintLadderProps) {
  const [ladder, setLadder] = useState<HintLadderData | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<HintRung | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const bodyRefs = useRef(new Map<string, HTMLDivElement | null>());
  const headingId = useId();
  const key = 'questionId' in target ? `questionId=${encodeURIComponent(target.questionId)}` : `buildStepId=${encodeURIComponent(target.buildStepId)}`;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/hints?${key}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await readError(res, null));
      setLadder((await res.json()) as HintLadderData);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Couldn’t load the hints.');
    }
  }, [key]);

  useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);

  const confirm = async () => {
    if (!confirming) return;
    const rung = confirming;
    setRevealing(true);
    setRevealError(null);
    try {
      const res = await fetch('/api/hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hintId: rung.hintId }),
      });
      if (!res.ok) {
        setRevealError(await readError(res, rung));
        return;
      }
      const data = (await res.json()) as { reveal: RevealResult; ladder: HintLadderData };
      setLadder(data.ladder);
      setConfirming(null);
      setAnnounce(`${LEVEL_LABEL[rung.level]} hint revealed.`);
      onReveal?.(data.reveal);
      requestAnimationFrame(() => bodyRefs.current.get(rung.hintId)?.focus());
    } catch {
      setRevealError('Couldn’t reach the server. Try again.');
    } finally {
      setRevealing(false);
    }
  };

  if (!ladder) {
    return (
      <div className={s.state}>
        {loadError ? (
          <>
            <p className={s.stateText}>{loadError}</p>
            <Button size="sm" icon="refresh" onClick={() => void load()}>
              Retry
            </Button>
          </>
        ) : (
          <span className={s.stateText} role="status">
            <Spinner size={13} /> Loading hints…
          </span>
        )}
      </div>
    );
  }

  const { rungs, penalty } = ladder;
  if (rungs.length === 0) {
    return (
      <div className={s.state}>
        <Icon name="lightbulb" size={18} style={{ color: 'var(--fg-3)' }} />
        <p className={s.stateText}>No hints for this one — you’re on your own.</p>
      </div>
    );
  }

  const revealedCount = rungs.filter((r) => r.revealed).length;
  const cantAfford = !!confirming && confirming.costKind === 'token' && confirming.costAmount > 0 && !confirming.affordable;
  const modalNote = revealError ? (
    <p className={s.modalError} role="alert">
      <Icon name="alert-circle" size={14} />
      {revealError}
    </p>
  ) : cantAfford ? (
    <p className={s.modalError} role="alert">
      <Icon name="alert-circle" size={14} />
      You don’t have enough {confirming.tokenTopic?.title ?? ''} tokens. Earn them by solving {confirming.tokenTopic?.title ?? 'that topic’s'}{' '}
      problems.
    </p>
  ) : undefined;

  return (
    <section className={s.ladder} aria-labelledby={headingId}>
      <header className={s.head}>
        <div>
          <h2 id={headingId} className={s.title}>
            Hints
          </h2>
          <p className={s.sub}>
            {revealedCount} of {rungs.length} revealed · each unlocks after the one before it.
          </p>
        </div>
        {solved ? (
          <Pill tone="ok" size="xs" icon="check">
            Solved · score costs waived
          </Pill>
        ) : (
          <Pill tone={penalty > 0 ? 'warn' : 'muted'} size="xs" title="Score penalty on this problem's token award">
            Penalty {penalty}%
          </Pill>
        )}
      </header>

      <ol className={s.rungs}>
        {rungs.map((rung, i) => {
          const state = rung.revealed ? 'revealed' : rung.revealable ? 'open' : 'locked';
          const previous = rungs[i - 1];
          return (
            <li key={rung.hintId} className={s.rung} data-state={state}>
              <span className={s.marker} aria-hidden="true">
                {rung.revealed ? <Icon name="check" size={12} /> : rung.revealable ? i + 1 : <Icon name="lock" size={11} />}
              </span>
              <div className={s.rungMain}>
                <div className={s.rungHead}>
                  <span className={s.level}>{LEVEL_LABEL[rung.level]}</span>
                  <span className={s.cost} data-kind={rung.costAmount === 0 ? 'free' : rung.costKind}>
                    {rung.costKind === 'token' && rung.costAmount > 0 && <Icon name="coin" size={11} />}
                    {costLabel(rung)}
                  </span>
                  <span className={s.spacer} />
                  {state === 'open' && (
                    <Button
                      size="xs"
                      variant={rung.costAmount === 0 ? 'default' : 'outline'}
                      icon="eye"
                      onClick={() => {
                        setRevealError(null);
                        setConfirming(rung);
                      }}
                      aria-label={`Reveal the ${LEVEL_LABEL[rung.level].toLowerCase()} hint (${costLabel(rung)})`}
                    >
                      Reveal
                    </Button>
                  )}
                </div>
                {state === 'revealed' && rung.bodyMd != null ? (
                  <div
                    className={s.body}
                    tabIndex={-1}
                    ref={(el) => {
                      bodyRefs.current.set(rung.hintId, el);
                    }}
                    aria-label={`${LEVEL_LABEL[rung.level]} hint`}
                  >
                    <Markdown compact>{rung.bodyMd}</Markdown>
                  </div>
                ) : (
                  <p className={s.blurb}>
                    {state === 'locked' && previous
                      ? `Reveal the ${LEVEL_LABEL[previous.level].toLowerCase()} first.`
                      : LEVEL_BLURB[rung.level]}
                    {state === 'open' && rung.costKind === 'token' && !rung.affordable && (
                      <span className={s.short}> You don’t have enough {rung.tokenTopic?.title ?? ''} tokens yet.</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>

      <Modal
        open={confirming !== null}
        onClose={() => !revealing && setConfirming(null)}
        role="alertdialog"
        size="sm"
        title={confirming ? `Reveal the ${LEVEL_LABEL[confirming.level].toLowerCase()} hint?` : ''}
        description={confirming ? costSentence(confirming, penalty, solved) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={revealing}>
              Cancel
            </Button>
            <Button variant="primary" icon="eye" loading={revealing} disabled={cantAfford} onClick={() => void confirm()}>
              {confirming && confirming.costAmount > 0 ? `Reveal · ${costLabel(confirming)}` : 'Reveal'}
            </Button>
          </>
        }
      >
        {modalNote}
      </Modal>
    </section>
  );
}
