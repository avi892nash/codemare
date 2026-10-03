'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logomark } from '@/components/ui/Logomark';
import { DropdownMenu } from '@/components/ui/Menu';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProfileMenu } from './ProfileMenu';
import { NAV_SECTIONS, formatTokens, isSectionActive, parseRole, type NavUser } from './nav-model';
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
 * tabs collapse into one "Menu" button — always that word, on every page; the
 * open menu marks the current section. Right side: token balance, theme
 * toggle, profile menu. Signed out: logo (to sign-in), theme, Sign in.
 *
 * On phones and touch devices every control is a 44 px target (see
 * Navbar.module.css): the logo, the Menu button, the token count, the theme
 * toggle and the avatar each have a 44 px box around what is drawn.
 */
export function Navbar({ user, tokenTotal, libraryVisible = false }: NavbarProps) {
  const pathname = usePathname() ?? '/';
  const viewer = user ? normalize(user) : null;
  const onAuthPage = pathname === '/auth' || pathname.startsWith('/signin');

  return (
    <header className={s.bar}>
      <a href="#main" className={s.skip}>Skip to content</a>

      <Link href={viewer ? '/map' : '/'} className={`${s.brand} focus-ring`} aria-label="Codemare home">
        <Logomark />
        {/* Signed in, the wordmark gives way below 480 px to leave room for the Menu button and the right-hand controls. */}
        <span className={viewer ? s.wordmarkHides : undefined} aria-hidden="true">codemare</span>
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
              label="Menu"
              triggerClassName={s.menuBtn}
              trigger={
                <span className={s.menuBox}>
                  <Icon name="grid" size={13} />
                  Menu
                  <Icon name="chev-down" size={12} />
                </span>
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
                className={`${s.tokensLink} focus-ring`}
                aria-label={`${tokenTotal.toLocaleString('en-US')} ${tokenTotal === 1 ? 'token' : 'tokens'} — open the tier map`}
              >
                <span className={`${s.tokens} mono`}>
                  <Icon name="coin" size={13} />
                  {formatTokens(tokenTotal)}
                </span>
              </Link>
            )}
            <ThemeToggle tap />
            <ProfileMenu user={viewer} libraryVisible={libraryVisible} />
          </>
        ) : (
          <>
            <ThemeToggle tap />
            <ButtonLink
              href="/signin"
              size="sm"
              tap
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
