'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/states/EmptyState';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
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
 * the badge's card — also when the page was opened on a deep link.
 *
 * A card is the emblem, the name, the rarity as a quiet word, and one line of
 * state: the date it was earned, or — while locked — how far along you are,
 * with a thin bar.
 */
export function BadgeGallery({ items, ownerName, isOwner }: { items: GalleryItem[]; ownerName: string; isOwner: boolean }) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const openSlug = params.get('badge');
  const selected = useMemo(() => items.find((b) => b.slug === openSlug) ?? null, [items, openSlug]);
  const [filter, setFilter] = useState<Filter>('all');
  const tiles = useRef<Record<string, HTMLButtonElement | null>>({});
  const pushed = useRef(false);
  const lastOpen = useRef<string | null>(selected?.slug ?? null);

  // When the modal closes (any way, including Back), return focus to its card.
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
      <div className={s.filter}>
        <Tabs
          id="badge-filter"
          aria-label="Filter badges"
          variant="underline"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          tabs={[
            { value: 'all', label: `All ${items.length}` },
            { value: 'earned', label: `Earned ${earned}` },
            { value: 'locked', label: `Locked ${items.length - earned}` },
          ]}
        />
        <TabPanel tabsId="badge-filter" value={filter} style={{ borderRadius: 'var(--r-lg)' }}>
          {shown.length === 0 ? (
            filter === 'earned' ? (
              <EmptyState
                size="sm"
                icon="award"
                title="No badges earned yet"
                description={`${isOwner ? 'You have' : `${ownerName} has`} not earned one. Open a locked badge to see what it takes.`}
              />
            ) : (
              <EmptyState size="sm" icon="award" title="Every badge is earned" description="Impressive." />
            )
          ) : (
            <ul className={s.cards} aria-label={`${shown.length} badges`}>
              {shown.map((b) => {
                const locked = !b.awardedAt;
                return (
                  <li key={b.slug}>
                    <button
                      ref={(el) => {
                        tiles.current[b.slug] = el;
                      }}
                      type="button"
                      className={`${s.card} focus-ring`}
                      data-earned={!locked}
                      aria-haspopup="dialog"
                      onClick={() => open(b.slug)}
                    >
                      <BadgeMedallion icon={b.icon} rarity={b.rarity} locked={locked} size={44} />
                      <span className={s.cardBody}>
                        <span className={s.cardTop}>
                          <span className={s.cardName}>{b.name}</span>
                          <span className={s.cardRarity}>{RARITY[b.rarity].label}</span>
                        </span>
                        <span className={s.cardState}>
                          {locked ? (
                            <>
                              <span className="sr-only">Locked. </span>
                              {b.progress ? (
                                <>
                                  <span>{b.progress.label}</span>
                                  <ProgressBar value={Math.round(b.progress.fraction * 100)} height={3} aria-label={`${b.name} progress`} valueText={b.progress.label} />
                                </>
                              ) : (
                                <span>Locked</span>
                              )}
                            </>
                          ) : (
                            <span className={s.cardDate}>
                              <Icon name="check-circle" size={12} />
                              Earned {fmtBadgeDate(b.awardedAt!)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabPanel>
      </div>

      <Modal
        open={!!selected}
        onClose={close}
        size="sm"
        title={selected?.name ?? ''}
        description={selected ? `${RARITY[selected.rarity].label} badge${heldBy(selected.heldByPercent)}` : undefined}
        footer={
          selected && (
            <>
              {isOwner && !selected.awardedAt && selected.cta && (
                <ButtonLink href={selected.cta.href} variant="default" size="sm" iconRight="arrow-right" className={s.dialogButton}>
                  {selected.cta.label}
                </ButtonLink>
              )}
              <Button variant="primary" size="sm" onClick={close} className={s.dialogButton}>
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
  const who = isOwner ? 'Your progress' : `${ownerName}’s progress`;
  return (
    <div className={s.focus}>
      <BadgeMedallion icon={badge.icon} rarity={badge.rarity} locked={locked} size={72} />
      {badge.description && !restates(badge.description, badge.howTo) && <p className={s.focusDesc}>{badge.description}</p>}
      {!locked && (
        <span className={s.earnedLine}>
          <Icon name="check-circle" size={16} />
          {isOwner ? 'You earned this' : `${ownerName} earned this`} on {fmtBadgeDate(badge.awardedAt!)}
        </span>
      )}
      <div className={s.howto}>
        <p className={s.howtoLabel}>{locked ? 'How to earn it' : 'Criteria'}</p>
        <p className={s.howtoText}>{badge.howTo}</p>
        {locked && badge.progress && (
          <div className={s.focusProgress}>
            <div className={s.focusProgressRow} aria-hidden="true">
              <span>{who}</span>
              <span className="mono">{badge.progress.label}</span>
            </div>
            <ProgressBar value={Math.round(badge.progress.fraction * 100)} aria-label={who} valueText={badge.progress.label} />
          </div>
        )}
      </div>
    </div>
  );
}
