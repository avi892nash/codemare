'use client';

import { signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import type { IconName } from '@/components/ui/Icon';
import { DropdownMenu, type MenuItem } from '@/components/ui/Menu';
import { roleAtLeast, type NavUser } from './nav-model';
import s from './Navbar.module.css';

/**
 * Avatar button → profile card + account links. Author appears for role ≥
 * author; Library only when `libraryVisible` (it is hidden by default, §7).
 * Profile and Badges need a handle; without one Profile falls back to the
 * legacy /profile route and Badges is omitted.
 */
export function ProfileMenu({ user, libraryVisible = false }: { user: NavUser; libraryVisible?: boolean }) {
  const pathname = usePathname();
  const profileHref = user.handle ? `/u/${user.handle}` : '/profile';
  // `section` links stay current on their sub-pages (/author/new, /library/graphs, …).
  const link = (label: string, href: string, icon: IconName, section = false): MenuItem => ({
    kind: 'link',
    label,
    href,
    icon,
    current: pathname === href || (section && !!pathname?.startsWith(`${href}/`)),
  });

  const items: MenuItem[] = [
    link('Profile', profileHref, 'user'),
    ...(user.handle ? [link('Badges', `/u/${user.handle}/badges`, 'award')] : []),
    ...(roleAtLeast(user.role, 'author') ? [link('Author', '/author', 'edit', true)] : []),
    ...(libraryVisible ? [link('Library', '/library', 'book-open', true)] : []),
    { kind: 'separator' },
    { kind: 'action', label: 'Sign out', icon: 'log-out', onSelect: () => void signOut({ redirectTo: '/' }) },
  ];

  return (
    <DropdownMenu
      label={`Account menu for ${user.name}`}
      trigger={<Avatar name={user.name} src={user.image} size={28} />}
      triggerClassName={s.avatarTrigger}
      width={248}
      header={
        <div className={s.card}>
          <Avatar name={user.name} src={user.image} size={36} />
          <div className={s.cardText}>
            <span className={s.cardName}>{user.name}</span>
            <span className={`${s.cardHandle} mono`}>{user.handle ? `@${user.handle}` : 'no handle yet'}</span>
          </div>
          <span className={s.cardRole}>{user.role}</span>
        </div>
      }
      items={items}
    />
  );
}
