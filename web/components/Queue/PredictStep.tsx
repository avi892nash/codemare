'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { submitPredictionAction } from '@/app/(workspace)/queue/actions';
import { Markdown } from '@/components/Problem/Markdown';
import { Button, ButtonLink } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import type { PredictStepView } from '@/lib/server/loopViews';
import { usePinnedStep } from './usePinnedStep';
import s from './queue.module.css';

const KEYS = 'ABCDEFGHIJ';

export interface PredictStepProps {
  view: PredictStepView;
  /** The step's prompt, rendered on the server. */
  prompt: ReactNode;
  /** The snippet as a CodeBlock, highlighted on the server. */
  snippet: ReactNode;
  meta: { componentTitle: string; topicTitle: string; index: number; count: number };
  /** Where "Continue" goes: the next step of the queue (null → back to the queue). */
  next: { href: string; title: string; kind: 'predict' | 'build' } | null;
}

/**
 * T2a — Predict: read the snippet, answer the question (choices or free
 * text), then see whether you were right and why. Answering completes the
 * step; the queue behind it advances.
 */
export function PredictStep({ view, prompt, snippet, meta, next }: PredictStepProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState(view.result?.answer ?? '');
  const [result, setResult] = useState(view.result);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const questionId = useId();
  usePinnedStep(view.stepId, result !== null);

  // Fresh server data (e.g. answered in another tab) wins over an empty local state.
  useEffect(() => {
    if (view.result) setResult((r) => r ?? view.result);
  }, [view.result]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || result) return;
    if (!answer.trim()) {
      setError(view.choices ? 'Pick an answer first.' : 'Type your answer first.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await submitPredictionAction(view.stepId, answer);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setResult({ answer, correct: res.correct, expected: res.expected, explanationMd: res.explanationMd });
      requestAnimationFrame(() => resultRef.current?.focus());
      router.refresh();
    } catch {
      setError('Couldn’t reach the server. Try again.');
    } finally {
      setPending(false);
    }
  };

  const locked = result !== null;
  const outcome = (choice: string): 'right' | 'wrong' | undefined => {
    if (!result) return undefined;
    if (choice === result.expected) return 'right';
    if (choice === result.answer && !result.correct) return 'wrong';
    return undefined;
  };

  return (
    <section className={s.card} aria-labelledby={titleId} data-testid="predict-step">
      <div>
        <div className={s.stepMeta}>
          <Pill tone="accent" size="xs" icon="eye">
            Predict
          </Pill>
          <span>
            Step {meta.index} of {meta.count} · <strong>{meta.componentTitle}</strong> · {meta.topicTitle}
          </span>
          <DifficultyPill level={view.difficulty} size="xs" />
          {result && (
            <Pill tone="ok" size="xs" icon="check">
              Done
            </Pill>
          )}
        </div>
        <h2 className={s.stepTitle} id={titleId}>
          {view.title}
        </h2>
      </div>
      {prompt}
      {snippet}

      <form onSubmit={(e) => void submit(e)} noValidate>
        {view.choices ? (
          <fieldset className={s.choices} aria-describedby={error ? `${questionId}-err` : undefined}>
            <legend className={s.question} id={questionId}>
              {view.question}
            </legend>
            <div className={s.choiceGrid}>
              {view.choices.map((choice, i) => {
                const o = outcome(choice);
                return (
                  <label key={choice} className={s.choice} data-locked={locked || undefined} data-outcome={o} data-testid={`choice-${i}`}>
                    <input
                      type="radio"
                      name={`predict-${view.stepId}`}
                      value={choice}
                      checked={answer === choice}
                      disabled={locked || pending}
                      onChange={() => {
                        setAnswer(choice);
                        setError(null);
                      }}
                    />
                    <span className={s.choiceKey} aria-hidden="true">
                      {KEYS[i]}
                    </span>
                    <span className={s.choiceText}>{choice}</span>
                    {o && (
                      <span className={s.choiceMark}>
                        <Icon name={o === 'right' ? 'check-circle' : 'x'} size={14} />
                        <span className="sr-only">{o === 'right' ? '(correct answer)' : '(your answer)'}</span>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <div>
            <p className={s.question} id={questionId}>
              {view.question}
            </p>
            <Input
              label="Your answer"
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setError(null);
              }}
              disabled={locked || pending}
              placeholder="Exactly what it prints"
              autoComplete="off"
              spellCheck={false}
              inputStyle={{ fontFamily: 'var(--font-mono)' }}
              error={error ?? undefined}
              full
              data-testid="predict-answer"
            />
          </div>
        )}
        {!locked && (
          <div className={s.answerRow}>
            <Button type="submit" variant="primary" icon="check" loading={pending} data-testid="predict-submit">
              Check my answer
            </Button>
            <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Work it out in your head first — no running this one.</span>
          </div>
        )}
        {error && view.choices && (
          <p className={s.formError} role="alert" id={`${questionId}-err`}>
            {error}
          </p>
        )}
      </form>

      {result && (
        <div className={s.verdict} data-correct={result.correct} role="status" data-testid="predict-result">
          <h3 className={s.verdictHead} ref={resultRef} tabIndex={-1}>
            <Icon name={result.correct ? 'check-circle' : 'alert-circle'} size={16} />
            {result.correct ? 'Correct' : 'Not quite'}
          </h3>
          {!result.correct && (
            <p className={s.verdictLine}>
              You said <code>{result.answer}</code>; the answer is <code>{result.expected}</code>.
            </p>
          )}
          {result.explanationMd && <Markdown compact>{result.explanationMd}</Markdown>}
          <div className={s.nextRow}>
            <ButtonLink href={next?.href ?? '/queue'} variant="primary" iconRight="arrow-right" data-testid="predict-continue">
              {next ? `Next: ${next.kind === 'build' ? 'build' : 'predict'} — ${next.title}` : 'Back to the queue'}
            </ButtonLink>
          </div>
        </div>
      )}
    </section>
  );
}
