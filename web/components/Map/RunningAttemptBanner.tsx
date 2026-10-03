'use client';

import { useRouter } from 'next/navigation';
import { Countdown } from '@/components/Loop/Countdown';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { MapView } from '@/lib/server/loopViews';
import s from './map.module.css';

/** A running gate attempt, pinned to the top of the map. */
export function RunningAttemptBanner({ running }: { running: NonNullable<MapView['running']> }) {
  const router = useRouter();
  return (
    <div className={s.running} role="region" aria-label="Gate attempt in progress" data-testid="running-attempt">
      <span className={s.runningIcon} aria-hidden="true">
        <Icon name="shield" size={18} />
      </span>
      <div className={s.runningMain}>
        <span className={s.runningTitle}>{running.gateTitle} in progress</span>
        <span className={s.runningMeta}>
          {running.solved} of {running.total} solved · pass with {running.passThreshold} to open {running.tierTitle}
        </span>
      </div>
      <span className={s.gateClock}>
        <Icon name="clock" size={14} />
        <Countdown to={running.deadlineAt} onExpire={() => router.refresh()} expiredText="Time’s up" />
        <span className="sr-only"> left</span>
      </span>
      <ButtonLink href={`/map/gates/${encodeURIComponent(running.attemptId)}`} variant="primary" size="sm" tap iconRight="arrow-right">
        Continue
      </ButtonLink>
    </div>
  );
}
