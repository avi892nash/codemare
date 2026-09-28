import { Icon } from '@/components/ui/Icon';
import type { PillTone } from '@/components/ui/Pill';
import type { BadgeRarity } from '@/lib/types';
import s from './badges.module.css';

export const RARITY: Record<BadgeRarity, { label: string; tone: PillTone }> = {
  common: { label: 'Common', tone: 'default' },
  rare: { label: 'Rare', tone: 'info' },
  epic: { label: 'Epic', tone: 'accent' },
  legendary: { label: 'Legendary', tone: 'warn' },
};

/**
 * A badge's round emblem, ringed in its rarity tone; locked badges are
 * dashed and neutral with a padlock. Decorative (the name is always printed
 * next to it). Server-safe.
 */
export function BadgeMedallion({ icon, rarity, locked = false, size = 56 }: { icon: string; rarity: BadgeRarity; locked?: boolean; size?: number }) {
  return (
    <span
      className={s.medallion}
      data-rarity={rarity}
      data-locked={locked || undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon name={icon} size={Math.round(size * 0.42)} strokeWidth={1.6} />
      {locked && (
        <span className={s.lock} style={size < 40 ? { width: 14, height: 14, right: -2, bottom: -2 } : undefined}>
          <Icon name="lock" size={size < 40 ? 8 : 11} />
        </span>
      )}
    </span>
  );
}
