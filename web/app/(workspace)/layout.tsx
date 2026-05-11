import { Navbar } from '@/components/Layout/Navbar';
import { auth } from '@/auth';

/**
 * Workspace layout: navbar on top, child route fills the rest. Reads the
 * session server-side so the navbar can render avatar vs "Sign in" without
 * client-side flicker.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth().catch(() => null);
  const user = session?.user ? { name: session.user.name ?? session.user.email ?? 'You' } : null;
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
      }}
    >
      <Navbar user={user} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{children}</div>
    </div>
  );
}
