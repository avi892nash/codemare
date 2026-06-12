'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar, Input, Logomark, Pill } from '@/components/ui/primitives';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * Top navigation bar. Active tab is derived from the current pathname so
 * Next.js routing drives state — no separate Mode union to keep in sync.
 *
 * The avatar / sign-in CTA on the right is split: showing the avatar means
 * the visitor is signed in, the Button means they aren't. Once Auth.js lands
 * we'll read the session in a server component and pass `user` as a prop.
 */
interface NavItem {
  name: string;
  href: string | null;
  icon: IconName;
  match?: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Problems',      href: '/',              icon: 'list',       match: (p) => p === '/' || p.startsWith('/p/') },
  { name: 'Learn',         href: null,             icon: 'graduation' },
  { name: 'IDE',           href: '/ide',           icon: 'terminal' },
  { name: 'Submissions',   href: '/submissions',   icon: 'history' },
];

interface NavbarProps {
  user?: { name: string } | null;
}

export function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();

  return (
    <header
      style={{
        height: 48,
        padding: '0 18px',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
      }}
    >
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'var(--fg-0)' }}>
        <Logomark />
        <span style={{ fontWeight: 600, letterSpacing: -0.2 }}>codemare</span>
        <Pill tone="muted" size="xs" style={{ fontFamily: 'var(--font-mono)', marginLeft: 6 }}>
          µs-judge
        </Pill>
      </Link>

      <nav style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        {NAV_ITEMS.map((it) => {
          const active = it.href != null && (it.match ? it.match(pathname) : pathname === it.href);
          const disabled = it.href === null;
          const labelStyle = {
            padding: '6px 10px',
            fontSize: 13,
            fontWeight: 500,
            background: active ? 'var(--bg-3)' : 'transparent',
            color: disabled ? 'var(--fg-4)' : active ? 'var(--fg-0)' : 'var(--fg-2)',
            border: 'none',
            borderRadius: 6,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            opacity: disabled ? 0.6 : 1,
            textDecoration: 'none',
          };

          if (disabled || !it.href) {
            return (
              <button key={it.name} disabled title="Coming soon" style={labelStyle}>
                <Icon name={it.icon} size={13} />
                {it.name}
              </button>
            );
          }
          return (
            <Link key={it.name} href={it.href} style={labelStyle}>
              <Icon name={it.icon} size={13} />
              {it.name}
            </Link>
          );
        })}
      </nav>

      <span style={{ flex: 1 }} />

      <Input icon="search" placeholder="Jump to problem…" kbd="⌘K" size="sm" />

      <a
        href="https://github.com/avi892nash/codemare"
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
        style={{
          width: 28, height: 28, borderRadius: 6,
          color: 'var(--fg-2)', display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <Icon name="github" size={15} />
      </a>

      {user ? (
        <Link href="/profile" title={user.name}>
          <Avatar name={user.name} size={26} />
        </Link>
      ) : (
        <Link
          href="/auth"
          style={{
            padding: '0 10px',
            height: 28,
            fontSize: 12,
            fontWeight: 500,
            background: pathname === '/auth' ? 'var(--accent-bg)' : 'var(--bg-2)',
            color: pathname === '/auth' ? 'var(--accent-hi)' : 'var(--fg-0)',
            border: `1px solid ${pathname === '/auth' ? 'var(--accent-line)' : 'var(--line-2)'}`,
            borderRadius: 'var(--r)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            textDecoration: 'none',
          }}
        >
          <Icon name="user" size={13} />
          Sign in
        </Link>
      )}
    </header>
  );
}
