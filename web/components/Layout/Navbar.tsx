'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logomark } from '@/components/ui/Logomark';
import { DropdownMenu } from '@/components/ui/Menu';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProfileMenu } from './ProfileMenu';
import { NAV_SECTIONS, activeSection, formatTokens, isSectionActive, parseRole, type NavUser } from './nav-model';
import s from './Navbar.module.css';

/** What the navbar needs to know about the viewer. `role` is parsed leniently. */
export interface NavbarUser {
  name: string;
  handle?: string | null;
  image?: string | null;
  role?: string | null;
}

export interface NavbarProps {
  user?: NavbarUser | null;
  /** Total token balance; the chip is hidden while undefined. */
  tokenTotal?: number;
  /** Show the hidden Library in the profile menu (FEATURE_LIBRARY_PUBLIC). */
  libraryVisible?: boolean;
}

function normalize(u: NavbarUser): NavUser {
  return { name: u.name, handle: u.handle ?? null, image: u.image ?? null, role: parseRole(u.role) };
}

/**
 * App shell top bar (L8). Section tabs are links with aria-current, active
 * by path prefix; the logo leads home — the tier map, which lists every
 * topic's problems (so the Map tab is current there too). Below 768 px the
 * tabs collapse into a section menu. Right side: token balance, theme
 * toggle, profile menu. Signed out: logo (to sign-in), theme, Sign in.
 */
export function Navbar({ user, tokenTotal, libraryVisible = false }: NavbarProps) {
  const pathname = usePathname() ?? '/';
  const viewer = user ? normalize(user) : null;
  const current = activeSection(pathname);
  const onAuthPage = pathname === '/auth' || pathname.startsWith('/signin');

  return (
    <header className={s.bar}>
      <a href="#main" className={s.skip}>Skip to content</a>

      <Link href={viewer ? '/map' : '/'} className={`${s.brand} focus-ring`} aria-label="Codemare home">
        <Logomark />
        <span className={s.wordmark} aria-hidden="true">codemare</span>
      </Link>

      {viewer && (
        <>
          <nav aria-label="Primary" className={s.tabs}>
            {NAV_SECTIONS.map((sec) => (
              <Link
                key={sec.key}
                href={sec.href}
                className={`${s.tab} focus-ring`}
                aria-current={isSectionActive(sec, pathname) ? 'page' : undefined}
              >
                <Icon name={sec.icon} size={13} />
                {sec.label}
              </Link>
            ))}
          </nav>

          <div className={s.sectionMenu}>
            <DropdownMenu
              align="start"
              width={210}
              label={current ? `Sections, current: ${current.label}` : 'Sections'}
              triggerStyle={{
                height: 30,
                padding: '0 8px',
                gap: 6,
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--fg-0)',
                background: 'var(--bg-2)',
                border: '1px solid var(--line-2)',
              }}
              trigger={
                <>
                  <Icon name={current?.icon ?? 'grid'} size={13} style={{ color: 'var(--accent-hi)' }} />
                  {current?.label ?? 'Menu'}
                  <Icon name="chev-down" size={12} style={{ color: 'var(--fg-2)' }} />
                </>
              }
              items={NAV_SECTIONS.map((sec) => ({
                kind: 'link' as const,
                label: sec.label,
                href: sec.href,
                icon: sec.icon,
                current: isSectionActive(sec, pathname),
              }))}
            />
          </div>
        </>
      )}

      <span className={s.spacer} />

      <div className={s.right}>
        {viewer ? (
          <>
            {tokenTotal != null && (
              <Link
                href="/map"
                className={`${s.tokens} focus-ring mono`}
                aria-label={`${tokenTotal.toLocaleString('en-US')} ${tokenTotal === 1 ? 'token' : 'tokens'} — open the tier map`}
              >
                <Icon name="coin" size={13} />
                {formatTokens(tokenTotal)}
              </Link>
            )}
            <ThemeToggle />
            <ProfileMenu user={viewer} libraryVisible={libraryVisible} />
          </>
        ) : (
          <>
            <ThemeToggle />
            <ButtonLink
              href="/signin"
              size="sm"
              variant={onAuthPage ? 'accent' : 'default'}
              icon="user"
              className={s.signIn}
            >
              Sign in
            </ButtonLink>
          </>
        )}
      </div>
    </header>
  );
}
