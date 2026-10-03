import { Icon } from '@/components/ui/Icon';
import type { PillTone } from '@/components/ui/Pill';
import type { BadgeRarity } from '@/lib/types';
import s from './badges.module.css';

/** Rarity is a word first (the gallery prints `label` as quiet text); `tone` is for the places that still draw a Pill. */
export const RARITY: Record<BadgeRarity, { label: string; tone: PillTone }> = {
  common: { label: 'Common', tone: 'default' },
  rare: { label: 'Rare', tone: 'info' },
  epic: { label: 'Epic', tone: 'accent' },
  legendary: { label: 'Legendary', tone: 'warn' },
};

/**
 * A badge's round emblem: accent-ringed once earned, dashed and neutral with a
 * padlock while locked — the same for every rarity (rarity is printed beside
 * it, not coloured). Decorative (the name is always printed next to it).
 * Server-safe.
 */
export function BadgeMedallion({ icon, rarity, locked = false, size = 56 }: { icon: string; rarity: BadgeRarity; locked?: boolean; size?: number }) {
  const small = size < 40;
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
        <span className={s.lock} style={small ? { width: 14, height: 14, right: -2, bottom: -2 } : undefined}>
          <Icon name="lock" size={small ? 8 : 10} />
        </span>
      )}
    </span>
  );
}
