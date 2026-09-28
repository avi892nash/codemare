'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { markReadAction } from '@/app/(workspace)/library/actions';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { useToast } from '@/components/ui/Toast';

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Mark as read" → app.library_progress (markArticleRead); then refreshes the page's progress. */
export function MarkRead({ articleId, readAt }: { articleId: string; readAt: string | null }) {
  const [read, setRead] = useState(readAt);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  if (read) {
    return (
      <Pill tone="ok" icon="check-circle" size="md" aria-live="polite">
        Read · {day(read)}
      </Pill>
    );
  }
  return (
    <Button
      variant="primary"
      icon="check"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await markReadAction(articleId);
          if (res.ok) {
            setRead(res.readAt);
            toast({ title: 'Marked as read', tone: 'ok' });
            router.refresh();
          } else {
            toast({ title: 'Could not mark it read', description: res.error, tone: 'err' });
          }
        })
      }
    >
      Mark as read
    </Button>
  );
}
