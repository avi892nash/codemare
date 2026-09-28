'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { useMounted } from '@/components/ui/hooks';
import type { BadgeRarity } from '@/lib/types';
import { BadgeMedallion, RARITY } from './BadgeMedallion';
import s from './badges.module.css';

export interface GalleryItem {
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: BadgeRarity;
  howTo: string;
  /** ISO timestamp, or null while locked. */
  awardedAt: string | null;
  progress: { current: number; target: number; label: string; fraction: number } | null;
  heldByPercent: number | null;
  /** Where to go to work on it (owner only). */
  cta: { href: string; label: string } | null;
}

type Filter = 'all' | 'earned' | 'locked';

const squash = (t: string) => t.toLowerCase().replace(/\(utc\)/g, '').replace(/[^a-z0-9]+/g, '');
/** A description that only restates the criteria adds nothing next to it. */
const restates = (a: string, b: string) => {
  const [x, y] = [squash(a), squash(b)];
  return !x || !y || x.includes(y) || y.includes(x);
};

const heldBy = (p: number | null) => (p === null ? '' : p === 0 ? ' · no learner has it yet' : ` · held by ${p}% of learners`);

export const fmtBadgeDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * B1 gallery + B2/B3 focus view. The open badge lives in the URL
 * (`?badge=<slug>`), so a badge is deep-linkable; opening pushes a history
 * entry (Back closes it), Esc / ✕ / backdrop close it, and focus returns to
 * the badge's tile — also when the page was opened on a deep link.
 */
export function BadgeGallery({ items, ownerName, isOwner }: { items: GalleryItem[]; ownerName: string; isOwner: boolean }) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const openSlug = params.get('badge');
  // Open only after hydration: the Modal portal mounts after hydration, and a
  // dialog open on the very first render would miss its focus / inert setup.
  const hydrated = useMounted();
  const selected = useMemo(() => (hydrated ? (items.find((b) => b.slug === openSlug) ?? null) : null), [hydrated, items, openSlug]);
  const [filter, setFilter] = useState<Filter>('all');
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});
  const pushed = useRef(false);
  const lastOpen = useRef<string | null>(selected?.slug ?? null);

  // When the modal closes (any way, including Back), return focus to its tile.
  useEffect(() => {
    if (selected) {
      lastOpen.current = selected.slug;
      return;
    }
    pushed.current = false;
    const slug = lastOpen.current;
    lastOpen.current = null;
    if (slug) tiles.current[slug]?.focus();
  }, [selected]);

  const open = (slug: string) => {
    pushed.current = true;
    window.history.pushState(null, '', `${pathname}?badge=${encodeURIComponent(slug)}`);
  };
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', pathname);
    }
  };

  const earned = items.filter((b) => b.awardedAt).length;
  const shown = items.filter((b) => (filter === 'all' ? true : filter === 'earned' ? !!b.awardedAt : !b.awardedAt));

  return (
    <>
      <Tabs
        id="badge-filter"
        aria-label="Filter badges"
        variant="pills"
        size="sm"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        tabs={[
          { value: 'all', label: 'All', count: items.length },
          { value: 'earned', label: 'Earned', count: earned },
          { value: 'locked', label: 'Locked', count: items.length - earned },
        ]}
      />
      <TabPanel tabsId="badge-filter" value={filter} style={{ borderRadius: 'var(--r-lg)' }}>
        {shown.length === 0 ? (
          <p style={{ margin: '24px 0', fontSize: 13, color: 'var(--fg-2)', textAlign: 'center' }}>
            {filter === 'earned' ? `${isOwner ? 'You have' : `${ownerName} has`} not earned a badge yet.` : 'Every badge is earned. Impressive.'}
          </p>
        ) : (
          <ul className={s.grid} aria-label={`${shown.length} badges`}>
            {shown.map((b) => {
              const locked = !b.awardedAt;
              return (
                <li key={b.slug}>
                  <button
                    ref={(el) => {
                      tiles.current[b.slug] = el;
                    }}
                    type="button"
                    className={`${s.tile} focus-ring`}
                    data-earned={!locked || undefined}
                    aria-haspopup="dialog"
                    onClick={() => open(b.slug)}
                  >
                    <BadgeMedallion icon={b.icon} rarity={b.rarity} locked={locked} size={56} />
                    <span className={s.tileName}>{b.name}</span>
                    <Pill tone={RARITY[b.rarity].tone} size="xs">
                      {RARITY[b.rarity].label}
                    </Pill>
                    <span className={s.tileState}>
                      {locked ? (
                        <>
                          <span className="sr-only">Locked. </span>
                          {b.progress ? (
                            <>
                              <ProgressBar value={Math.round(b.progress.fraction * 100)} height={3} aria-label={`${b.name} progress`} valueText={b.progress.label} />
                              <span>{b.progress.label}</span>
                            </>
                          ) : (
                            <span>Locked</span>
                          )}
                        </>
                      ) : (
                        <span className={s.tileDate}>
                          <Icon name="check-circle" size={12} />
                          Earned {fmtBadgeDate(b.awardedAt!)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </TabPanel>

      <Modal
        open={!!selected}
        onClose={close}
        size="sm"
        title={selected?.name ?? ''}
        description={
          selected
            ? `${RARITY[selected.rarity].label} badge${heldBy(selected.heldByPercent)}`
            : undefined
        }
        footer={
          selected && (
            <>
              {isOwner && !selected.awardedAt && selected.cta && (
                <ButtonLink href={selected.cta.href} variant="default" size="sm" iconRight="arrow-right">
                  {selected.cta.label}
                </ButtonLink>
              )}
              <Button variant="primary" size="sm" onClick={close}>
                Close
              </Button>
            </>
          )
        }
      >
        {selected && <FocusView badge={selected} ownerName={ownerName} isOwner={isOwner} />}
      </Modal>
    </>
  );
}

function FocusView({ badge, ownerName, isOwner }: { badge: GalleryItem; ownerName: string; isOwner: boolean }) {
  const locked = !badge.awardedAt;
  return (
    <div className={s.focus}>
      <BadgeMedallion icon={badge.icon} rarity={badge.rarity} locked={locked} size={96} />
      {badge.description && !restates(badge.description, badge.howTo) && <p className={s.focusDesc}>{badge.description}</p>}
      {locked ? (
        <div className={s.howto}>
          <span className={s.howtoLabel}>How to earn it</span>
          <span style={{ fontSize: 13, color: 'var(--fg-1)' }}>{badge.howTo}</span>
          {badge.progress && (
            <ProgressBar
              value={Math.round(badge.progress.fraction * 100)}
              label={isOwner ? 'Your progress' : `${ownerName}’s progress`}
              showValue
              valueText={badge.progress.label}
            />
          )}
        </div>
      ) : (
        <>
          <span className={s.earnedLine}>
            <Icon name="check-circle" size={15} />
            {isOwner ? 'You earned this' : `${ownerName} earned this`} on {fmtBadgeDate(badge.awardedAt!)}
          </span>
          <div className={s.howto}>
            <span className={s.howtoLabel}>Criteria</span>
            <span style={{ fontSize: 13, color: 'var(--fg-1)' }}>{badge.howTo}</span>
          </div>
        </>
      )}
    </div>
  );
}
