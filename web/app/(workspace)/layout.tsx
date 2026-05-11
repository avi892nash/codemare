import { Navbar } from '@/components/Layout/Navbar';

/**
 * Workspace layout: navbar on top, child route fills the rest. Used for the
 * catalog, problem detail, IDE, design system and auth pages — everything
 * that shares the standard chrome.
 *
 * Once Auth.js is in place, this becomes an async server component that
 * reads the session and passes `user` to the Navbar.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)',
      }}
    >
      <Navbar />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{children}</div>
    </div>
  );
}
