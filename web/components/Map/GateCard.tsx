'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { startGateAction, type ActionError } from '@/app/(workspace)/map/actions';
import { Countdown, LocalTime } from '@/components/Loop/Countdown';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import type { GateCardView } from '@/lib/server/loopViews';
import s from './map.module.css';

function gateError(e: ActionError): string {
  if (e.error === 'gate_not_eligible') {
    if (e.reason === 'cooldown') return 'This gate is still cooling down.';
    if (e.reason === 'running') return 'You already have an attempt running — continue it instead.';
    if (e.reason === 'already_open') return 'This tier is already open.';
    return 'Open the tier before this one first.';
  }
  return e.message;
}

/**
 * The gate that opens a closed tier, in one line: its name, what it asks
 * ("Solve 3 of 4 in 45 min") and — when the learner can act — one button.
 * Its problems are in the topics' lists and in the confirmation, and the
 * cooldown is in the confirmation too: this card does not repeat them. The
 * button starts the gate after a confirmation, continues a running attempt
 * or opens the last one; a cooling gate counts down (and refreshes the map
 * when it runs out, so the server can settle the state).
 */
export function GateCard({ gate, tier }: { gate: GateCardView; tier: { slug: string; title: string } }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => router.refresh(), [router]);
  const titleId = `gate-${gate.id}-title`;

  const start = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await startGateAction(gate.id);
      if (!res.ok) {
        setError(gateError(res.error));
        router.refresh();
        return;
      }
      // The action's promise settles a moment before the router lets go of it; a navigation
      // started in between would discard it. Wait a tick, then go.
      await new Promise((r) => setTimeout(r, 0));
      router.push(`/map/gates/${encodeURIComponent(res.attemptId)}`);
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setPending(false);
    }
  };

  const asks = `Solve ${gate.passThreshold} of ${gate.questionCount} in ${gate.timeLimitMinutes} min`;
  let line: ReactNode = asks;
  if (gate.state === 'eligible' && gate.last && gate.last.passed === false) {
    line = (
      <>
        {asks} · last try: {gate.last.passedCount} of {gate.passThreshold} needed
      </>
    );
  } else if (gate.state === 'running') {
    line = <>Attempt in progress</>;
  } else if (gate.state === 'cooldown' && gate.nextEligibleAt) {
    line = (
      <>
        Retry in <Countdown to={gate.nextEligibleAt} onExpire={refresh} expiredText="a moment" /> · at <LocalTime iso={gate.nextEligibleAt} />
      </>
    );
  } else if (gate.state === 'previous_tier_closed') {
    line = (
      <>
        {asks} · available once{' '}
        {gate.previousTier ? (
          <a href={`#tier-${gate.previousTier.slug}`} className={`${s.inlineLink} focus-ring`}>
            {gate.previousTier.title}
          </a>
        ) : (
          'the tier before it'
        )}{' '}
        is open
      </>
    );
  } else if (gate.state === 'passed') {
    line = <>Passed{gate.last?.finishedAt && <> · <LocalTime iso={gate.last.finishedAt} /></>}</>;
  }

  return (
    <section className={s.gate} data-state={gate.state} id={`gate-${gate.id}`} aria-labelledby={titleId} data-testid={`gate-${tier.slug}`}>
      <span className={s.gateIcon} aria-hidden="true">
        <Icon name="shield" size={16} />
      </span>
      <div className={s.gateText}>
        <h3 className={s.gateTitle} id={titleId}>
          {gate.title}
        </h3>
        <p className={s.gateLine}>{line}</p>
      </div>

      <div className={s.gateAction}>
        {gate.state === 'eligible' && (
          <Button variant="primary" size="sm" icon="play" onClick={() => setConfirming(true)} data-testid="start-gate">
            Start the gate
          </Button>
        )}
        {gate.state === 'running' && gate.running && (
          <ButtonLink href={`/map/gates/${encodeURIComponent(gate.running.attemptId)}`} variant="primary" size="sm" iconRight="arrow-right">
            Continue attempt
          </ButtonLink>
        )}
        {gate.state === 'cooldown' && gate.last && (
          <ButtonLink href={`/map/gates/${encodeURIComponent(gate.last.attemptId)}`} size="sm" variant="ghost">
            Last attempt · {gate.last.passedCount}/{gate.passThreshold}
          </ButtonLink>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        role="alertdialog"
        title={`Start the ${gate.title}?`}
        description={`The ${gate.timeLimitMinutes}-minute clock starts now and keeps running if you leave the page.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Not yet
            </Button>
            <Button variant="primary" icon="play" loading={pending} onClick={() => void start()} data-testid="confirm-start-gate">
              Start · {gate.timeLimitMinutes} min
            </Button>
          </>
        }
      >
        <ul className={s.dialogList}>
          <li>
            Solve {gate.passThreshold} of {gate.questionCount}: {gate.questions.map((q) => q.title).join(', ')}.
          </li>
          <li>Only submissions made inside the attempt count. You can finish early once you have {gate.passThreshold}.</li>
          <li>Pass and {tier.title} opens. Miss, and the gate cools down for {gate.cooldownHours} hours.</li>
        </ul>
        {error && (
          <div className={s.formError} role="alert">
            <Icon name="alert-circle" size={14} />
            <div>{error}</div>
          </div>
        )}
      </Modal>
    </section>
  );
}
