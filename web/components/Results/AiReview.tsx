'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';
import { Markdown } from '@/components/Problem/Markdown';
import type { AiReviewView, ReviewDepth } from '@/lib/server/aiReview';
import s from './AiReview.module.css';

function tokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * "AI review" for an accepted submission: a quick review first, then an
 * optional deeper one on the stronger model. Purely advisory — the verdict
 * above it is the judge's and doesn't change.
 */
export function AiReview({ submissionId }: { submissionId: string }) {
  const [reviews, setReviews] = useState<AiReviewView[]>([]);
  const [pending, setPending] = useState<ReviewDepth | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (depth: ReviewDepth) => {
    setPending(depth);
    setError(null);
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, depth }),
      });
      const body = (await res.json().catch(() => null)) as { review?: AiReviewView; message?: string } | null;
      if (!res.ok || !body?.review) {
        setError(body?.message ?? `The review failed (${res.status}).`);
        return;
      }
      const review = body.review;
      setReviews((prev) => [...prev.filter((r) => r.id !== review.id), review]);
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setPending(null);
    }
  };

  const hasQuick = reviews.some((r) => r.depth === 'quick');
  const hasDeep = reviews.some((r) => r.depth === 'deep');

  return (
    <section className={s.panel} aria-label="AI review" data-testid="ai-review">
      <div className={s.head}>
        <span className={s.title}>
          <Icon name="sparkle" size={14} /> AI review
        </span>
        <span className={s.note}>Advisory only — your verdict is the judge’s.</span>
        <span className={s.spacer} />
        {!hasQuick && (
          <Button size="xs" tap variant="accent" icon="sparkle" loading={pending === 'quick'} disabled={pending !== null} onClick={() => void ask('quick')}>
            Review my code
          </Button>
        )}
        {hasQuick && !hasDeep && (
          <Button size="xs" tap variant="outline" icon="layers" loading={pending === 'deep'} disabled={pending !== null} onClick={() => void ask('deep')}>
            Deeper review
          </Button>
        )}
      </div>
      {pending && (
        <p className={s.status} role="status">
          <Spinner size={13} /> {pending === 'deep' ? 'Writing a deeper review…' : 'Reviewing your solution…'}
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          <Icon name="alert-circle" size={13} /> {error}
        </p>
      )}
      {reviews.map((r) => (
        <article key={r.id} className={s.review}>
          <div className={s.meta}>
            <span className={s.depth} data-depth={r.depth}>
              {r.depth === 'deep' ? 'Deeper review' : 'Quick review'}
            </span>
            <span className="mono">{r.model}</span>
            <span className="mono">
              {tokens(r.inputTokens + r.cacheReadTokens)} in · {tokens(r.outputTokens)} out
              {r.cacheReadTokens > 0 ? ` · ${tokens(r.cacheReadTokens)} cached` : ''}
            </span>
          </div>
          <Markdown compact>{r.contentMd}</Markdown>
        </article>
      ))}
    </section>
  );
}
