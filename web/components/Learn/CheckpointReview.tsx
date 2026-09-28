import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import type { CheckpointReview as Review } from '@/lib/server/learnViews';
import { Prose } from './Prose';
import s from './learn.module.css';

const fmtDate = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });

/**
 * L6 results: score, pass/fail, and per question the learner's answer, the
 * expected one and the explanation. Rendered on the server from a stored
 * attempt, so it survives reloads and never ships answers before grading.
 */
export function CheckpointReview({
  review,
  passPercent,
  retakeHref,
  continueTo,
}: {
  review: Review;
  passPercent: number;
  retakeHref: string;
  continueTo: { href: string; label: string } | null;
}) {
  const { attempt, items } = review;
  const pct = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  return (
    <div className={s.stack} style={{ gap: 16 }}>
      <section className={s.scoreCard} data-passed={attempt.passed} aria-labelledby="score-title">
        <div className="mono" aria-hidden="true">
          <span className={s.scoreBig}>{attempt.score}</span>
          <span className={s.scoreOf}>/{attempt.total}</span>
        </div>
        <div>
          <h2 id="score-title" style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--fg-0)' }}>
            <span className="sr-only">
              Score {attempt.score} of {attempt.total}.{' '}
            </span>
            {attempt.passed ? 'Checkpoint passed' : 'Not passed yet'}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--fg-2)' }}>
            {pct}% correct · {passPercent}% needed · attempt from {fmtDate(attempt.createdAt)} UTC
          </p>
        </div>
        <div className={s.row}>
          <ButtonLink href={retakeHref} variant={attempt.passed ? 'default' : 'primary'} size="sm" icon="refresh">
            Retake
          </ButtonLink>
          {continueTo && (
            <ButtonLink href={continueTo.href} variant={attempt.passed ? 'primary' : 'default'} size="sm" iconRight="arrow-right">
              {continueTo.label}
            </ButtonLink>
          )}
        </div>
      </section>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((q, i) => (
          <li key={q.id} className={s.qblock}>
            <div className={s.qlegend}>
              <span className={`${s.qnum} mono`} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <div className={s.row} style={{ marginBottom: 6 }}>
                  <Pill tone={q.correct ? 'ok' : 'err'} size="xs" icon={q.correct ? 'check' : 'x'}>
                    {q.correct ? 'Correct' : 'Incorrect'}
                  </Pill>
                  <span className="sr-only">Question {i + 1}:</span>
                </div>
                <Prose md={q.promptMd} compact />
              </div>
            </div>

            {q.kind === 'mcq' ? (
              <ul className={s.choices} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {q.choices.map((c, k) => {
                  const isAnswer = k === q.expectedIndex;
                  const isGiven = k === q.givenIndex;
                  const result = isAnswer ? 'correct' : isGiven ? 'wrong' : undefined;
                  return (
                    <li key={k} className={s.choice} data-result={result} style={{ cursor: 'default' }}>
                      <Icon
                        name={isAnswer ? 'check-circle' : isGiven ? 'x' : 'circle'}
                        size={16}
                        style={{ marginTop: 2, color: isAnswer ? 'var(--ok-fg)' : isGiven ? 'var(--err-fg)' : 'var(--fg-2)' }}
                      />
                      <span>
                        <Prose md={c} inline />
                        {isAnswer && (
                          <span className={s.choiceTag} data-kind="correct">
                            Correct answer
                          </span>
                        )}
                        {isGiven && (
                          <span className={s.choiceTag} data-kind={isAnswer ? 'correct' : 'wrong'}>
                            Your answer
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
                {q.givenIndex === null && <li className={s.muted} style={{ fontSize: 12.5 }}>You didn’t answer this one.</li>}
              </ul>
            ) : (
              <div className={s.answerLine}>
                <span>
                  Your answer: <b className="mono">{q.given ?? '—'}</b>
                </span>
                {!q.correct && (
                  <span>
                    Accepted: <b className="mono">{q.expected}</b>
                  </span>
                )}
              </div>
            )}

            {q.explanationMd && (
              <div className={s.explain}>
                <div className={s.eyebrow} style={{ marginBottom: 4 }}>
                  <Icon name="lightbulb" size={12} /> Why
                </div>
                <Prose md={q.explanationMd} compact />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
