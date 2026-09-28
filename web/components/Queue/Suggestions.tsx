import { ButtonLink } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import type { QueueSuggestion } from '@/lib/server/queue';
import s from './queue.module.css';

/** What to do once the build steps are done: an open gate, then problems that pay what the map needs. */
export function SuggestionCards({ items }: { items: QueueSuggestion[] }) {
  return (
    <ul className={s.suggestions} data-testid="suggestions">
      {items.map((item) =>
        item.kind === 'gate' ? (
          <li key={`gate-${item.gateId}`} className={s.suggestion} data-kind="gate">
            <span className={s.suggestionIcon} aria-hidden="true">
              <Icon name="shield" size={15} />
            </span>
            <div className={s.suggestionMain}>
              <span className={s.suggestionTitle}>{item.state === 'running' ? `${item.title} in progress` : `Take the ${item.title}`}</span>
              <span className={s.suggestionMeta}>
                Solve {item.passThreshold} of {item.questionCount} in {item.timeLimitMinutes} min to open {item.tierTitle}.
              </span>
            </div>
            <ButtonLink
              href={item.attemptId ? `/map/gates/${encodeURIComponent(item.attemptId)}` : `/map#gate-${item.gateId}`}
              size="sm"
              variant="primary"
              iconRight="arrow-right"
            >
              {item.state === 'running' ? 'Continue' : 'To the gate'}
            </ButtonLink>
          </li>
        ) : (
          <li key={item.slug} className={s.suggestion}>
            <span className={s.suggestionIcon} aria-hidden="true">
              <Icon name="code" size={15} />
            </span>
            <div className={s.suggestionMain}>
              <span className={s.suggestionTitle}>
                {item.title} <DifficultyPill level={item.difficulty} size="xs" />
              </span>
              <span className={s.suggestionMeta}>
                <span className={s.award}>{item.award.map((a) => `+${a.amount} ${a.topic}`).join(' · ')}</span>
                {item.reason && <> · {item.reason}</>}
              </span>
            </div>
            <ButtonLink href={`/problems/${encodeURIComponent(item.slug)}`} size="sm" iconRight="arrow-right" aria-label={`Solve ${item.title}`}>
              Solve
            </ButtonLink>
          </li>
        )
      )}
    </ul>
  );
}
