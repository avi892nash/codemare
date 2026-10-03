import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BadgeGallery, type GalleryItem } from '@/components/Badges/BadgeGallery';
import { badgeCta } from '@/components/Badges/BadgeStrip';
import bs from '@/components/Badges/badges.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { LoopPage } from '@/components/Loop/LoopPage';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { findProfileUser, getBadgeGalleryView } from '@/lib/server/profile';

type Params = { handle: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findProfileUser(decodeURIComponent(handle));
  return { title: user ? `Badges · @${user.handle} · Codemare` : 'Badges · Codemare' };
}

/**
 * B1 — badge gallery: earned vs locked, rarity, progress toward each
 * criterion, under the shared page header (a title and one line: how many are
 * earned). B2/B3 — the focus view opens in a modal, deep-linkable with
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
    <LoopPage label={isOwner ? 'Your badges' : `${user.name}’s badges`}>
      <div className={bs.head}>
        <Breadcrumb
          items={[
            { label: isOwner ? 'Your profile' : `@${user.handle}`, href: `/u/${user.handle}`, icon: 'user' },
            { label: 'Badges' },
          ]}
        />
        <PageHeader title={isOwner ? 'Your badges' : `${user.name}’s badges`} subtitle={`${earned} of ${badges.length} earned`} />
      </div>
      <BadgeGallery items={items} ownerName={user.name} isOwner={isOwner} />
    </LoopPage>
  );
}
