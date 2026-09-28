'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { startGateAction, type ActionError } from '@/app/(workspace)/map/actions';
import { Countdown, LocalTime } from '@/components/Loop/Countdown';
import { plural } from '@/components/Loop/awards';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { GateCardView } from '@/lib/server/loopViews';
import type { GateState } from '@/lib/server/gates';
import s from './map.module.css';

const STATE: Record<GateState, { label: string; tone: PillTone; icon: IconName }> = {
  eligible: { label: 'Open to you', tone: 'accent', icon: 'play' },
  running: { label: 'In progress', tone: 'warn', icon: 'clock' },
  cooldown: { label: 'Cooling down', tone: 'muted', icon: 'history' },
  passed: { label: 'Passed', tone: 'ok', icon: 'check' },
  previous_tier_closed: { label: 'Not yet', tone: 'muted', icon: 'lock' },
};

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
 * The gate that opens a tier: what it asks (problems, threshold, time,
 * cooldown) and its state for this learner — start it (with a
 * confirmation), continue a running attempt, a cooldown countdown, or
 * passed. Countdowns refresh the map when they run out, so the server can
 * settle the attempt.
 */
export function GateCard({ gate, tier }: { gate: GateCardView; tier: { slug: string; title: string } }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => router.refresh(), [router]);
  const titleId = `gate-${gate.id}-title`;
  const meta = STATE[gate.state];

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

  return (
    <section className={s.gate} data-state={gate.state} id={`gate-${gate.id}`} aria-labelledby={titleId} data-testid={`gate-${tier.slug}`}>
      <span className={s.gateIcon} aria-hidden="true">
        <Icon name="shield" size={18} />
      </span>
      <div className={s.gateMain}>
        <div className={s.gateTop}>
          <h3 className={s.gateTitle} id={titleId}>
            {gate.title}
          </h3>
          <Pill tone={meta.tone} size="xs" icon={meta.icon} data-testid="gate-state">
            {meta.label}
          </Pill>
        </div>
        <p className={s.gateSummary}>{gate.summary}</p>
        <ul className={s.facts}>
          <li>
            <Icon name="list" size={12} /> {plural(gate.questionCount, 'problem')}
          </li>
          <li>
            <Icon name="target" size={12} /> pass with {gate.passThreshold}
          </li>
          <li>
            <Icon name="clock" size={12} /> {gate.timeLimitMinutes} min
          </li>
          <li>
            <Icon name="history" size={12} /> {gate.cooldownHours} h cooldown after a miss
          </li>
        </ul>
        {gate.questions.length > 0 && (
          <ul className={s.gateQs} aria-label={`${gate.title} problems`}>
            {gate.questions.map((q) => (
              <li key={q.slug} className={s.gateQ}>
                <span className={s.diffDot} data-level={q.difficulty} aria-hidden="true" />
                <span>
                  {q.title}
                  <span className="sr-only"> ({q.difficulty})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={s.gateAction}>
        {gate.state === 'eligible' && (
          <>
            <Button variant="primary" icon="play" onClick={() => setConfirming(true)} data-testid="start-gate">
              Start the gate
            </Button>
            {gate.last && gate.last.passed === false && (
              <p className={s.gateNote}>
                Last try: {gate.last.passedCount} of {gate.passThreshold} needed.
              </p>
            )}
          </>
        )}
        {gate.state === 'running' && gate.running && (
          <>
            <span className={s.gateClock}>
              <Icon name="clock" size={14} />
              <Countdown to={gate.running.deadlineAt} onExpire={refresh} expiredText="Time’s up" />
              <span className="sr-only"> left</span>
            </span>
            <ButtonLink href={`/map/gates/${encodeURIComponent(gate.running.attemptId)}`} variant="primary" iconRight="arrow-right">
              Continue attempt
            </ButtonLink>
          </>
        )}
        {gate.state === 'cooldown' && gate.nextEligibleAt && (
          <>
            <p className={s.gateNote}>
              Retry in{' '}
              <strong>
                <Countdown to={gate.nextEligibleAt} onExpire={refresh} expiredText="a moment" />
              </strong>
              <br />
              at <LocalTime iso={gate.nextEligibleAt} />
            </p>
            {gate.last && (
              <ButtonLink href={`/map/gates/${encodeURIComponent(gate.last.attemptId)}`} size="sm" variant="ghost">
                Last attempt · {gate.last.passedCount}/{gate.passThreshold}
              </ButtonLink>
            )}
          </>
        )}
        {gate.state === 'passed' && (
          <p className={s.gateNote}>
            <strong>{tier.title}</strong> is open
            {gate.last?.finishedAt && (
              <>
                <br />
                passed <LocalTime iso={gate.last.finishedAt} />
              </>
            )}
          </p>
        )}
        {gate.state === 'previous_tier_closed' && (
          <p className={s.gateNote}>Opens once {gate.previousTier?.title ?? 'the tier before'} is open.</p>
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
