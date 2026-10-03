import Link from 'next/link';
import type { BadgeCriteria, BadgeRarity } from '@/lib/types';
import { BadgeMedallion } from './BadgeMedallion';
import s from './badges.module.css';

/** Where a learner goes to work toward a badge. */
export function badgeCta(criteria: BadgeCriteria | null): { href: string; label: string } | null {
  if (!criteria) return null;
  switch (criteria.kind) {
    case 'topics_unlocked':
    case 'tier_open':
    case 'gate_first_try':
      return { href: '/map', label: 'Open the tier map' };
    case 'lessons_completed':
    case 'track_completed':
      return { href: '/learn', label: 'Go to Learn' };
    default:
      return { href: '/map', label: 'Find a problem on the map' };
  }
}

/** Earned badges as quiet links (emblem and name) to their focus view in the gallery. Server-safe. */
export function BadgeStrip({
  handle,
  badges,
  max = 8,
}: {
  handle: string;
  badges: { slug: string; name: string; icon: string; rarity: BadgeRarity }[];
  max?: number;
}) {
  return (
    <ul className={s.strip}>
      {badges.slice(0, max).map((b) => (
        <li key={b.slug}>
          <Link href={`/u/${handle}/badges?badge=${b.slug}`} className={`${s.stripLink} focus-ring`}>
            <BadgeMedallion icon={b.icon} rarity={b.rarity} size={28} />
            {b.name}
          </Link>
        </li>
      ))}
    </ul>
  );
}
