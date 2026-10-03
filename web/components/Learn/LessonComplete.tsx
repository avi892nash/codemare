'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type { CompleteLessonResult } from '@/app/(workspace)/learn/actions';
import s from './learn.module.css';

export interface LessonCompleteProps {
  trackSlug: string;
  lessonSlug: string;
  completed: boolean;
  /** Where to go after finishing: the next lesson, the checkpoint, or the track page. */
  next: { href: string; label: string } | null;
  startLesson: (trackSlug: string, lessonSlug: string) => Promise<void>;
  completeLesson: (trackSlug: string, lessonSlug: string) => Promise<CompleteLessonResult>;
}

/**
 * "Mark complete" for a lesson (completeLesson → badge evaluation), plus the
 * first-view `started` mark that powers "continue where you left off".
 * Newly earned badges are announced as toasts. After completing, focus
 * moves to the next step so keyboard users are not stranded.
 */
export function LessonComplete({ trackSlug, lessonSlug, completed, next, startLesson, completeLesson }: LessonCompleteProps) {
  const [done, setDone] = useState(completed);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const nextRef = useRef<HTMLAnchorElement>(null);
  const focusNext = useRef(false);

  useEffect(() => setDone(completed), [completed]);

  useEffect(() => {
    if (!completed) void startLesson(trackSlug, lessonSlug).catch(() => undefined);
    // Only on arrival at a lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackSlug, lessonSlug]);

  useEffect(() => {
    if (done && focusNext.current) {
      focusNext.current = false;
      nextRef.current?.focus();
    }
  }, [done]);

  const onComplete = () => {
    setError(null);
    startTransition(async () => {
      const res = await completeLesson(trackSlug, lessonSlug).catch(() => ({ ok: false as const, error: 'Could not save. Check your connection and try again.' }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      focusNext.current = true;
      setDone(true);
      toast({ title: 'Lesson complete', description: 'Progress saved.', tone: 'ok', id: `lesson-${lessonSlug}` });
      for (const b of res.badges) {
        toast({ title: `Badge earned: ${b.name}`, description: 'See it in your badge gallery.', tone: 'info', duration: 8000 });
      }
    });
  };

  return (
    <section className={s.complete} data-done={done || undefined} aria-label="Lesson progress">
      <span aria-hidden="true" className={s.completeIcon}>
        <Icon name={done ? 'check-circle' : 'book-open'} size={22} />
      </span>
      <div className={s.completeText} role="status">
        <span className={s.completeTitle}>{done ? 'Lesson complete' : 'Finished reading?'}</span>
        <span className={s.completeSub}>
          {error ? (
            <span style={{ color: 'var(--err-fg)' }}>{error}</span>
          ) : done ? (
            next ? `Up next: ${next.label}` : 'That was the last step of this track.'
          ) : (
            'Mark it complete to track your progress and earn learning badges.'
          )}
        </span>
      </div>
      {done ? (
        next && (
          <ButtonLink ref={nextRef} href={next.href} variant="primary" iconRight="arrow-right" className={s.completeBtn}>
            Continue
          </ButtonLink>
        )
      ) : (
        <Button variant="primary" icon="check" loading={pending} onClick={onComplete} className={s.completeBtn}>
          Mark complete
        </Button>
      )}
    </section>
  );
}
