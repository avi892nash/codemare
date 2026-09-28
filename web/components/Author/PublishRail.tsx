'use client';

import { useEffect, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { PublishStatus } from '@/lib/types';
import { ProblemList, sectionDomId } from './kit';
import type { CheckItem } from './model';
import s from './author.module.css';

export type RailBusy = 'save' | 'publish' | 'unpublish' | 'delete' | null;

export interface PublishRailProps {
  status: PublishStatus;
  savedAt: string | null;
  dirty: boolean;
  isNew: boolean;
  slug: string;
  checklist: CheckItem[];
  busy: RailBusy;
  runningReferences: boolean;
  error: { message: string; details: string[] } | null;
  onSave: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  onRunReferences: () => void;
}

function relative(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Sticky publish rail: status, the live checklist (each item links to the
 * section that fixes it), Save draft / Publish. Publish stays disabled until
 * every check passes; the server re-checks everything anyway.
 */
export function PublishRail({
  status, savedAt, dirty, isNew, slug, checklist, busy, runningReferences, error,
  onSave, onPublish, onUnpublish, onDelete, onRunReferences,
}: PublishRailProps) {
  const [now, setNow] = useState(() => Date.now());
  const [modKey, setModKey] = useState('⌘');
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) setModKey('Ctrl+');
    return () => window.clearInterval(t);
  }, []);

  const done = checklist.filter((c) => c.ok).length;
  const ready = done === checklist.length;
  const published = status === 'published';
  const refItem = checklist.find((c) => c.key === 'reference');

  return (
    <aside className={s.rail} aria-label="Publish">
      <div className={s.railHead}>
        <div className={s.railStatus}>
          <Pill tone={published ? 'ok' : 'warn'} dot size="sm">
            {published ? 'Published' : 'Draft'}
          </Pill>
          <span className={s.railSaved} aria-live="polite">
            {dirty ? 'Unsaved changes' : isNew ? 'Not saved yet' : savedAt ? `Saved ${relative(savedAt, now)}` : 'Saved'}
          </span>
        </div>
        <p className={s.help}>
          {published
            ? 'Live in the catalog. Changes go live when you publish them.'
            : 'Only you and staff can see drafts.'}
        </p>
      </div>

      <div className={`${s.railBody} scroll`}>
        <div className={s.railProgress}>
          <ProgressBar
            value={done}
            max={checklist.length}
            tone={ready ? 'ok' : 'accent'}
            label="Ready to publish"
            showValue
            valueText={`${done} of ${checklist.length}`}
          />
        </div>
        <ul className={s.checklist} aria-label="Publish checklist">
          {checklist.map((c) => (
            <li key={c.key} className={s.check} data-ok={c.ok}>
              <span className={s.checkIcon} data-ok={c.ok}>
                <Icon name={c.ok ? 'check-circle' : 'circle'} size={16} label={c.ok ? 'done' : 'to do'} />
              </span>
              <div style={{ minWidth: 0 }}>
                <a className={`${s.checkLink} focus-ring`} href={`#${sectionDomId(c.section)}`}>
                  {c.label}
                </a>
                {!c.ok && <ProblemList problems={c.problems} max={3} />}
                {c.key === 'reference' && !c.ok && refItem && !refItem.problems.some((p) => p.startsWith('A Python')) && (
                  <Button size="xs" icon="play" loading={runningReferences} onClick={onRunReferences} style={{ marginTop: 6 }}>
                    Run references
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className={s.railFoot}>
        {error && (
          <div className={s.railError} role="alert">
            <Icon name="alert-circle" size={14} />
            <div>
              {error.message}
              {error.details.length > 0 && <ProblemList problems={error.details} max={4} />}
            </div>
          </div>
        )}
        <div className={s.railButtons}>
          {published ? (
            <Button icon="eye-off" onClick={onUnpublish} loading={busy === 'unpublish'} disabled={busy !== null && busy !== 'unpublish'}>
              Unpublish
            </Button>
          ) : (
            <Button icon="bookmark" onClick={onSave} loading={busy === 'save'} disabled={busy !== null && busy !== 'save'} kbd={`${modKey}S`}>
              Save draft
            </Button>
          )}
          <Button
            variant="primary"
            icon="send"
            onClick={onPublish}
            loading={busy === 'publish'}
            disabled={!ready || (published && !dirty) || (busy !== null && busy !== 'publish')}
          >
            {published ? 'Publish changes' : 'Publish'}
          </Button>
        </div>
        <p className={s.help} aria-live="polite">
          {busy === 'publish'
            ? 'Re-running every reference solution on the judge…'
            : ready
              ? published && !dirty
                ? 'Everything is live.'
                : 'All checks pass. Publishing re-verifies on the judge.'
              : `Complete the checklist to publish (${checklist.length - done} left).`}
        </p>
        {!isNew && (
          <div className={s.railLinks}>
            {published ? (
              <ButtonLink href={`/problems/${slug}`} variant="ghost" size="xs" icon="external" target="_blank" rel="noopener">
                View in catalog
              </ButtonLink>
            ) : (
              <span />
            )}
            {!published && (
              <Button variant="ghost" size="xs" icon="trash" onClick={onDelete} loading={busy === 'delete'} disabled={busy !== null && busy !== 'delete'}>
                Delete draft
              </Button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
