'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { SubmitCheckpointResult } from '@/app/(workspace)/learn/actions';
import s from './learn.module.css';

export interface QuizQuestion {
  id: string;
  kind: 'mcq' | 'short';
  /** Server-rendered prompt (sanitized markdown). */
  prompt: ReactNode;
  /** Server-rendered choice labels (mcq). */
  choices: ReactNode[];
}

export interface CheckpointQuizProps {
  trackSlug: string;
  moduleSlug: string;
  questions: QuizQuestion[];
  passPercent: number;
  submit: (trackSlug: string, moduleSlug: string, responses: Record<string, unknown>) => Promise<SubmitCheckpointResult>;
}

/**
 * L6 quiz. Radios for multiple choice (native keyboard behavior: arrows
 * move within a group), a text field for short answers. Answers stay on the
 * client until submit; grading, answers and explanations live on the
 * server, which renders the review at `?attempt=<id>`.
 */
export function CheckpointQuiz({ trackSlug, moduleSlug, questions, passPercent, submit }: CheckpointQuizProps) {
  const router = useRouter();
  const { toast } = useToast();
  const base = useId();
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  const isAnswered = (q: QuizQuestion) => {
    const a = answers[q.id];
    return q.kind === 'mcq' ? typeof a === 'number' : typeof a === 'string' && a.trim() !== '';
  };
  const answered = questions.filter(isAnswered).length;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const missing = questions.find((q) => !isAnswered(q));
    if (missing) {
      setError(`Answer every question first — ${questions.length - answered} left.`);
      const el = groupRefs.current[missing.id];
      el?.scrollIntoView({ block: 'center' });
      el?.querySelector<HTMLElement>('input')?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submit(trackSlug, moduleSlug, answers).catch(() => ({ ok: false as const, error: 'Could not submit. Check your connection and try again.' }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast({
        title: res.passed ? `Passed · ${res.score}/${res.total}` : `${res.score}/${res.total} — not passed yet`,
        description: res.passed ? 'Checkpoint complete.' : `You need ${passPercent}% to pass. Review the explanations and try again.`,
        tone: res.passed ? 'ok' : 'warn',
      });
      for (const b of res.badges) toast({ title: `Badge earned: ${b.name}`, tone: 'info', duration: 8000 });
      router.push(`/learn/${trackSlug}/${moduleSlug}/checkpoint?attempt=${encodeURIComponent(res.attemptId)}`, { scroll: true });
    });
  };

  return (
    <form className={s.quiz} onSubmit={onSubmit} noValidate aria-describedby={`${base}-rule`}>
      <p id={`${base}-rule`} className="sr-only">
        {questions.length} questions. You need {passPercent}% to pass.
      </p>
      {questions.map((q, i) => {
        const promptId = `${base}-q${i}`;
        return (
          <fieldset
            key={q.id}
            ref={(el) => {
              groupRefs.current[q.id] = el;
            }}
            className={s.qblock}
            aria-labelledby={promptId}
          >
            <div className={s.qlegend}>
              <span className={`${s.qnum} mono`} aria-hidden="true">
                {i + 1}
              </span>
              <div id={promptId}>
                <span className="sr-only">
                  Question {i + 1} of {questions.length}:{' '}
                </span>
                {q.prompt}
              </div>
            </div>
            {q.kind === 'mcq' ? (
              <div className={s.choices}>
                {q.choices.map((c, k) => (
                  <label key={k} className={s.choice}>
                    <input
                      type="radio"
                      name={`${base}-${q.id}`}
                      value={k}
                      checked={answers[q.id] === k}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: k }))}
                    />
                    <span>{c}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Input
                aria-labelledby={promptId}
                placeholder="Your answer"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                style={{ maxWidth: 420 }}
              />
            )}
          </fieldset>
        );
      })}

      <div className={s.quizBar}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }} className="mono">
          {answered}/{questions.length} answered
        </span>
        <span role="alert" style={{ fontSize: 12.5, color: 'var(--err-fg)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {error && (
            <>
              <Icon name="alert-circle" size={14} />
              {error}
            </>
          )}
        </span>
        <span className={s.spacer} />
        <Button type="submit" variant="primary" icon="send" loading={pending}>
          Submit answers
        </Button>
      </div>
    </form>
  );
}
