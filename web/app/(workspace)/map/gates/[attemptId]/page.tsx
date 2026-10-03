import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SectionHead } from '@/components/Loop/LoopHead';
import { LoopPage } from '@/components/Loop/LoopPage';
import { LocalTime } from '@/components/Loop/Countdown';
import { requireViewer } from '@/components/Learn/viewer';
import { AttemptClock, AttemptLive, CooldownClock, FinishGateButton } from '@/components/Map/GateAttempt';
import s from '@/components/Map/attempt.module.css';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusDot } from '@/components/ui/StatusDot';
import { NotFoundError } from '@/lib/server/errors';
import { getGateAttemptView, type GateAttemptPageView } from '@/lib/server/loopViews';

export const metadata: Metadata = { title: 'Gate attempt · Codemare', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Params = Promise<{ attemptId: string }>;

function Questions({ view }: { view: GateAttemptPageView }) {
  return (
    <section aria-labelledby="gate-questions">
      <SectionHead
        title="Problems"
        id="gate-questions"
        note={view.running ? 'Submissions count while the clock runs' : `Solved in this attempt: ${view.solvedCount} of ${view.questions.length}`}
      />
      <ol className={s.qList} data-testid="gate-questions">
        {view.questions.map((q) => (
          <li key={q.slug} className={s.qRow} data-solved={q.solved || undefined} data-testid={`gate-question-${q.slug}`}>
            {/* The Map's own glyphs: solved is a check, not yet is an empty circle; the words are for a screen reader. */}
            <span className={s.qMark} aria-hidden="true">
              <StatusDot status={q.solved ? 'solved' : 'unsolved'} />
            </span>
            <div className={s.qMain}>
              <span className="sr-only">{q.solved ? 'Solved: ' : 'Not solved: '}</span>
              <span className={s.qTitle}>{q.title}</span>
              <DifficultyText level={q.difficulty} />
            </div>
            {view.running && (
              <div className={s.qAction}>
                <ButtonLink
                  href={`/problems/${encodeURIComponent(q.slug)}?attempt=${encodeURIComponent(view.attemptId)}`}
                  size="sm"
                  variant={q.solved ? 'ghost' : 'default'}
                  iconRight="arrow-right"
                  aria-label={`${q.solved ? 'Open' : 'Solve'} ${q.title}`}
                >
                  {q.solved ? 'Open' : 'Solve'}
                </ButtonLink>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Running({ view }: { view: GateAttemptPageView }) {
  const needed = Math.max(0, view.gate.passThreshold - view.solvedCount);
  return (
    <>
      <AttemptLive renderId={randomUUID()} />
      <div className={s.attemptTop}>
        <div className={s.progressCard}>
          <div className={s.progressLine} data-testid="gate-progress">
            <strong className="mono">
              {view.solvedCount}/{view.questions.length}
            </strong>
            <span>
              solved · pass with {view.gate.passThreshold}
              {needed === 0 ? <span className={s.passing}> · passing</span> : ` · ${needed} to go`}
            </span>
          </div>
          <ProgressBar
            value={Math.min(view.solvedCount, view.gate.passThreshold)}
            max={view.gate.passThreshold}
            tone={needed === 0 ? 'ok' : 'accent'}
            aria-label="Progress toward the pass threshold"
            valueText={`${view.solvedCount} of ${view.gate.passThreshold} needed`}
          />
        </div>
        <div className={s.clockCard} role="group" aria-label="Time left">
          <span className={s.clockLabel}>Time left</span>
          <AttemptClock deadlineAt={view.deadlineAt} />
          <span className={s.clockSub}>
            ends <LocalTime iso={view.deadlineAt} options={{ hour: 'numeric', minute: '2-digit' }} />
          </span>
        </div>
      </div>
      <div className={s.finishBar}>
        <p className={s.finishText}>
          {needed === 0
            ? `You have enough to pass. Finish now to open ${view.tier.title} — or keep solving.`
            : `Solve ${needed} more to pass. The attempt finishes by itself when the clock runs out; finishing early below ${view.gate.passThreshold} fails it.`}
        </p>
        <FinishGateButton
          attemptId={view.attemptId}
          solved={view.solvedCount}
          passThreshold={view.gate.passThreshold}
          cooldownHours={view.gate.cooldownHours}
          tierTitle={view.tier.title}
        />
      </div>
    </>
  );
}

function Result({ view }: { view: GateAttemptPageView }) {
  const passed = view.passed === true;
  return (
    <div className={s.result} data-passed={passed} role="status" data-testid="gate-result">
      <span className={s.resultIcon} aria-hidden="true">
        <Icon name={passed ? 'trophy' : 'history'} size={20} />
      </span>
      <div className={s.resultBody}>
        <h2 className={s.resultTitle}>{passed ? `Passed — ${view.tier.title} is open` : 'Not passed this time'}</h2>
        <p className={s.resultText}>
          Solved {view.passedCount} · {view.gate.passThreshold} needed
          {view.finishedAt && (
            <>
              {' '}
              · finished <LocalTime iso={view.finishedAt} />
            </>
          )}
          .{' '}
          {passed
            ? `Spend a recipe on the map to unlock a topic in ${view.tier.title}.`
            : view.gateState === 'eligible'
              ? 'The cooldown is over — you can try again.'
              : null}
        </p>
        {!passed && view.gateState === 'cooldown' && view.nextEligibleAt && !view.superseded && (
          <p className={s.resultText}>
            You can retry in{' '}
            <strong>
              <CooldownClock until={view.nextEligibleAt} />
            </strong>{' '}
            (at <LocalTime iso={view.nextEligibleAt} />). Practice meanwhile — every accepted solve still earns tokens.
          </p>
        )}
        <div className={s.resultActions}>
          {passed ? (
            <ButtonLink href={`/map#tier-${view.tier.slug}`} variant="primary" icon="lock-open">
              Unlock a {view.tier.title} topic
            </ButtonLink>
          ) : (
            <ButtonLink href={`/map#gate-${view.gate.id}`} variant="primary" icon="map">
              Back to the map
            </ButtonLink>
          )}
          {passed && (
            <ButtonLink href="/map" variant="ghost" icon="list">
              Find a problem on the map
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A gate attempt: while it runs — the countdown, progress against the pass
 * threshold, the problems (each opening in gate mode), and Finish; once it
 * is over (finished, or lazily past its deadline) — the result.
 */
export default async function GateAttemptPage({ params }: { params: Params }) {
  const { attemptId } = await params;
  const viewer = await requireViewer(`/map/gates/${encodeURIComponent(attemptId)}`);
  let view: GateAttemptPageView;
  try {
    view = await getGateAttemptView(viewer.id, attemptId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <LoopPage label={view.gate.title}>
      <Breadcrumb items={[{ label: 'Tier map', href: '/map' }, { label: view.gate.title }]} />
      <PageHeader
        title={view.gate.title}
        subtitle={`Solve ${view.gate.passThreshold} of these ${view.questions.length} problems within ${view.gate.timeLimitMinutes} minutes to open ${view.tier.title}.`}
      />
      {view.running ? <Running view={view} /> : <Result view={view} />}
      <Questions view={view} />
    </LoopPage>
  );
}
