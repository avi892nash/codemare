'use client';

import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import type { RunRequestError } from '@/lib/client/runState';
import s from './Workspace.module.css';

interface BlockerView {
  topic?: { title?: string };
  blocker?: { kind?: string; tier?: { title?: string }; cheapest?: { title?: string; missing?: number } } | null;
}

function blockerLine(b: BlockerView): string {
  const topic = b.topic?.title ?? 'A topic';
  const k = b.blocker;
  if (k?.kind === 'gate') return `${topic}: its tier${k.tier?.title ? ` (${k.tier.title})` : ''} opens when you pass its gate.`;
  if (k?.kind === 'recipe' && k.cheapest) {
    return k.cheapest.missing
      ? `${topic}: ${k.cheapest.missing} more token${k.cheapest.missing === 1 ? '' : 's'} for “${k.cheapest.title}”.`
      : `${topic}: ready to unlock with “${k.cheapest.title}”.`;
  }
  return `${topic} is locked.`;
}

/**
 * Why a run never started — each API error with its way out: the map for a
 * locked question, the queue for missing dependencies, sign-in for an
 * expired session, retry for the rest.
 */
export function RunErrorNotice({ error, onRetry }: { error: RunRequestError; onRetry?: () => void }) {
  const body = error.body ?? {};
  let icon: IconName = 'alert-circle';
  let title = 'That didn’t run';
  let message = error.message;
  let action = onRetry ? (
    <Button size="sm" icon="refresh" onClick={onRetry}>
      Try again
    </Button>
  ) : null;
  let details: string[] = [];

  if (error.code === 'access_denied' && body.reason === 'gate_attempt_closed') {
    icon = 'clock';
    title = 'This gate attempt has ended';
    message = 'Submissions after the deadline don’t count. Your result is on the map.';
    action = (
      <ButtonLink href="/map" size="sm" variant="primary" icon="map">
        See the result
      </ButtonLink>
    );
  } else if (error.code === 'access_denied' && body.reason === 'topic_locked') {
    icon = 'lock';
    title = 'This question is locked';
    details = ((body.blockers as BlockerView[] | undefined) ?? []).map(blockerLine);
    action = (
      <ButtonLink href="/map" size="sm" variant="primary" icon="map">
        Open the map
      </ButtonLink>
    );
  } else if (error.code === 'missing_dependencies') {
    icon = 'puzzle';
    title = 'Build its dependencies first';
    message = 'This component calls your own versions of the ones below — each needs a passing build in this language.';
    details = ((body.missing as string[] | undefined) ?? []).map((slug) => `${slug} — no passing version yet`);
    action = (
      <ButtonLink href="/me/library" size="sm" icon="layers">
        My library
      </ButtonLink>
    );
  } else if (error.code === 'rate_limited') {
    icon = 'clock';
    title = 'Slow down a little';
  } else if (error.status === 401 || error.code === 'unauthorized') {
    icon = 'user';
    title = 'Signed out';
    action = (
      <ButtonLink href={`/auth?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/')}`} size="sm" variant="primary" icon="user">
        Sign in again
      </ButtonLink>
    );
  } else if (error.code === 'invalid_input' || error.code === 'source_too_large' || error.code === 'payload_too_large') {
    title = 'Check your input';
    action = null;
  } else if (error.code === 'judge_unavailable' || error.code === 'judge_error' || error.code === 'network' || error.code === 'stream_closed') {
    icon = 'cpu';
    title = 'The judge didn’t answer';
  }

  return (
    <div className={s.notice} role="alert" data-testid="run-error">
      <span className={s.noticeIcon} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className={s.noticeMain}>
        <p className={s.noticeTitle}>{title}</p>
        <p className={s.noticeText}>{message}</p>
        {details.length > 0 && (
          <ul className={s.noticeList}>
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      {action}
    </div>
  );
}
