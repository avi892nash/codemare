import type { ToastApi } from '@/components/ui/Toast';

/** A badge as the loop's server actions return it. */
export interface BadgeView {
  slug: string;
  name: string;
  description: string;
}

/** One toast per newly earned badge — the same wording as the solving workspace. */
export function toastBadges(toast: ToastApi['toast'], badges: readonly BadgeView[]): void {
  for (const b of badges) {
    toast({ tone: 'info', title: `Badge earned: ${b.name}`, description: b.description, duration: 8000 });
  }
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
