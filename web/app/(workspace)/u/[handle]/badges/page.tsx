import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeGallery, type GalleryItem } from '@/components/Badges/BadgeGallery';
import { badgeCta } from '@/components/Badges/BadgeStrip';
import bs from '@/components/Badges/badges.module.css';
import { PageShell } from '@/components/Learn/parts';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { findProfileUser, getBadgeGalleryView } from '@/lib/server/profile';

type Params = { handle: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findProfileUser(decodeURIComponent(handle));
  return { title: user ? `Badges · @${user.handle} · Codemare` : 'Badges · Codemare' };
}

/**
 * B1 — badge gallery: earned vs locked, rarity, progress toward each
 * criterion. B2/B3 — the focus view opens in a modal, deep-linkable with
 * `?badge=<slug>` (handled in BadgeGallery from the URL).
 */
export default async function BadgesPage({ params }: { params: Promise<Params> }) {
  const { handle } = await params;
  const viewer = await requireViewer(`/u/${handle}/badges`);
  const view = await getBadgeGalleryView(decodeURIComponent(handle), viewer.id);
  if (!view) notFound();
  const { user, badges, earned, isOwner } = view;

  const items: GalleryItem[] = badges.map((b) => ({
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    rarity: b.rarity,
    howTo: b.howTo,
    awardedAt: b.awardedAt?.toISOString() ?? null,
    progress: b.progress,
    heldByPercent: b.heldByPercent,
    cta: isOwner ? badgeCta(b.criteria) : null,
  }));

  return (
    <PageShell>
      <Breadcrumb
        items={[
          { label: isOwner ? 'Your profile' : `@${user.handle}`, href: `/u/${user.handle}`, icon: 'user' },
          { label: 'Badges' },
        ]}
      />
      <header className={s.hero}>
        <div className={s.header}>
          <span className={s.eyebrow}>
            <Icon name="award" size={13} /> Badges
          </span>
          <h1 className={s.title}>{isOwner ? 'Your badges' : `${user.name}’s badges`}</h1>
          <p className={s.subtitle}>
            Badges mark milestones across practice, the learning loop and lessons. Open one to see what it takes and how
            close {isOwner ? 'you are' : 'they are'}.
          </p>
        </div>
        <div className={`${s.card} ${bs.summary}`} style={{ minWidth: 260 }}>
          <div className="mono" aria-hidden="true">
            <span className={bs.summaryCount}>{earned}</span>
            <span className={bs.summaryOf}> / {badges.length}</span>
          </div>
          <ProgressBar value={earned} max={Math.max(1, badges.length)} label="Earned" showValue valueText={`${earned} of ${badges.length}`} tone="accent" />
        </div>
      </header>
      <BadgeGallery items={items} ownerName={user.name} isOwner={isOwner} />
    </PageShell>
  );
}
