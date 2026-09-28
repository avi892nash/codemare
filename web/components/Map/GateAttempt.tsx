'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { finishGateAction } from '@/app/(workspace)/map/actions';
import { Countdown } from '@/components/Loop/Countdown';
import { toastBadges } from '@/components/Loop/awards';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import s from './map.module.css';

const LIVE_MS = 10_000;
/** Server renders this browser has already shown (see AttemptLive). */
const shownRenders = new Set<string>();

/**
 * Keeps a running attempt's page live: re-renders it from the server every
 * few seconds while visible, whenever the tab comes back, and right away
 * when the page is a copy restored from the router cache (the back button
 * from a gate problem) — so questions solved in the editor show up here.
 * `renderId` is unique per server render; seeing one again means a restore.
 */
export function AttemptLive({ renderId }: { renderId: string }) {
  const router = useRouter();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    if (handled.current !== renderId) {
      handled.current = renderId;
      if (shownRenders.has(renderId)) refresh();
      else shownRenders.add(renderId);
    }
    const t = window.setInterval(refresh, LIVE_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [router, renderId]);
  return null;
}

/** The attempt's big countdown; announces 5 min, 1 min and time's up, then lets the server settle the result. */
export function AttemptClock({ deadlineAt }: { deadlineAt: string }) {
  const router = useRouter();
  const [announce, setAnnounce] = useState('');
  const spoken = useRef(new Set<string>());
  const deadline = new Date(deadlineAt).getTime();

  useEffect(() => {
    const tick = () => {
      const left = deadline - Date.now();
      const say = (key: string, text: string) => {
        if (spoken.current.has(key)) return;
        spoken.current.add(key);
        setAnnounce(text);
      };
      if (left <= 0) say('0', 'Time is up. This gate attempt has ended.');
      else if (left <= 60_000) say('1', 'One minute left in the gate attempt.');
      else if (left <= 5 * 60_000) say('5', 'Five minutes left in the gate attempt.');
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [deadline]);

  return (
    <>
      <Countdown to={deadlineAt} onExpire={() => router.refresh()} expiredText="Time’s up" className={s.bigClock} data-testid="attempt-countdown" />
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </>
  );
}

/** A cooldown countdown that refreshes the page when the gate can be retried. */
export function CooldownClock({ until }: { until: string }) {
  const router = useRouter();
  return <Countdown to={until} onExpire={() => router.refresh()} expiredText="now" />;
}

interface FinishProps {
  attemptId: string;
  solved: number;
  passThreshold: number;
  cooldownHours: number;
  tierTitle: string;
}

/**
 * Finish the attempt now. Below the threshold it asks first (finishing
 * fails the attempt and starts the cooldown); at or above it, finishing
 * opens the tier.
 */
export function FinishGateButton({ attemptId, solved, passThreshold, cooldownHours, tierTitle }: FinishProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passing = solved >= passThreshold;

  const finish = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await finishGateAction(attemptId);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setOpen(false);
      if (res.passed) {
        toast({ tone: 'ok', title: `Gate passed — ${tierTitle} is open`, description: `${res.passedCount} of ${res.passThreshold} needed. Unlock its topics on the map.` });
      } else {
        toast({
          tone: 'warn',
          title: 'Gate not passed',
          description: `${res.passedCount} of ${res.passThreshold} needed. You can retry after the ${cooldownHours}-hour cooldown.`,
        });
      }
      toastBadges(toast, res.badges);
      router.refresh();
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant={passing ? 'primary' : 'default'} icon="check-circle" onClick={() => setOpen(true)} data-testid="finish-gate">
        Finish attempt
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        role="alertdialog"
        size="sm"
        title={passing ? `Finish and open ${tierTitle}?` : 'Finish without passing?'}
        description={
          passing
            ? `You’ve solved ${solved} — enough to pass. Finishing now opens ${tierTitle}.`
            : `You’ve solved ${solved} of the ${passThreshold} needed. Finishing now fails the attempt and starts a ${cooldownHours}-hour cooldown.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Keep going
            </Button>
            <Button
              variant={passing ? 'primary' : 'danger'}
              icon="check-circle"
              loading={pending}
              onClick={() => void finish()}
              data-testid="confirm-finish-gate"
            >
              {passing ? 'Finish · pass' : 'Finish anyway'}
            </Button>
          </>
        }
      >
        {error && (
          <div className={s.formError} role="alert">
            <Icon name="alert-circle" size={14} />
            <div>{error}</div>
          </div>
        )}
      </Modal>
    </>
  );
}
