import { Navbar } from '@/components/Layout/Navbar';
import { toNavUser } from '@/components/Layout/nav-model';
import { auth } from '@/auth';
import { getTokenTotal } from '@/lib/server/loopViews';

/**
 * Workspace layout: navbar on top, child route fills the rest. Reads the
 * session server-side so the navbar renders avatar vs "Sign in" without
 * client-side flicker. `role` / `handle` are read defensively (toNavUser) —
 * they join the session type separately. The token chip shows the sum of
 * the user's topic balances (hidden if it can't be read).
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth().catch(() => null);
  const user = toNavUser(session?.user);
  const libraryVisible = process.env.FEATURE_LIBRARY_PUBLIC === 'true';
  const userId = session?.user?.id;
  const tokenTotal = userId
    ? await getTokenTotal(userId).catch((e) => {
        console.error('[layout] token total unavailable:', e);
        return undefined;
      })
    : undefined;
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
      }}
    >
      <Navbar user={user} tokenTotal={tokenTotal} libraryVisible={libraryVisible} />
      <div id="main" tabIndex={-1} style={{ flex: 1, minHeight: 0, display: 'flex', outline: 'none' }}>
        {children}
      </div>
    </div>
  );
}
