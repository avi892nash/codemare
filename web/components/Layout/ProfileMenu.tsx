'use client';

import { signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import type { IconName } from '@/components/ui/Icon';
import { DropdownMenu, type MenuItem } from '@/components/ui/Menu';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { roleAtLeast, type NavRole, type NavUser } from './nav-model';
import s from './Navbar.module.css';

const ROLE_TONE: Record<NavRole, PillTone> = {
  learner: 'muted',
  author: 'accent',
  staff: 'info',
  admin: 'warn',
};

/**
 * Avatar button → profile card + account links. Author appears for role ≥
 * author; Library only when `libraryVisible` (it is hidden by default, §7).
 * Profile and Badges need a handle; without one Profile falls back to the
 * legacy /profile route and Badges is omitted.
 */
export function ProfileMenu({ user, libraryVisible = false }: { user: NavUser; libraryVisible?: boolean }) {
  const pathname = usePathname();
  const profileHref = user.handle ? `/u/${user.handle}` : '/profile';
  const link = (label: string, href: string, icon: IconName): MenuItem => ({
    kind: 'link',
    label,
    href,
    icon,
    current: pathname === href,
  });

  const items: MenuItem[] = [
    link('Profile', profileHref, 'user'),
    link('My Library', '/me/library', 'puzzle'),
    ...(user.handle ? [link('Badges', `/u/${user.handle}/badges`, 'award')] : []),
    ...(roleAtLeast(user.role, 'author') ? [link('Author', '/author', 'edit')] : []),
    ...(libraryVisible ? [link('Library', '/library', 'book-open')] : []),
    { kind: 'separator' },
    { kind: 'action', label: 'Sign out', icon: 'log-out', onSelect: () => void signOut({ redirectTo: '/' }) },
  ];

  return (
    <DropdownMenu
      label={`Account menu for ${user.name}`}
      trigger={<Avatar name={user.name} src={user.image} size={26} />}
      triggerClassName={s.avatarTrigger}
      width={248}
      header={
        <div className={s.card}>
          <Avatar name={user.name} src={user.image} size={36} />
          <div className={s.cardText}>
            <span className={s.cardName}>{user.name}</span>
            <span className={`${s.cardHandle} mono`}>{user.handle ? `@${user.handle}` : 'no handle yet'}</span>
          </div>
          <Pill tone={ROLE_TONE[user.role]} size="xs" style={{ textTransform: 'capitalize' }}>
            {user.role}
          </Pill>
        </div>
      }
      items={items}
    />
  );
}
