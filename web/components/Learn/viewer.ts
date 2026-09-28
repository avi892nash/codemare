import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * The signed-in viewer for learn/profile pages. The middleware already
 * walls these routes; this is the belt to its braces (and gives pages a
 * typed id). Redirects to sign-in with a way back.
 */
export async function requireViewer(next: string): Promise<{ id: string; handle: string | null }> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect(`/auth?next=${encodeURIComponent(next)}`);
  return { id, handle: session?.user?.handle || null };
}
