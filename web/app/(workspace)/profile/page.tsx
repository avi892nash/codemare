import { redirect } from 'next/navigation';
import { signInHref } from '@/components/Auth/routes';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

/**
 * Old route (spec §7): /profile → /u/<handle>. The handle rides in the
 * session; sessions minted before it did fall back to a lookup by id.
 */
export default async function LegacyProfileRedirect() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect(signInHref('/profile'));
  let handle = session?.user?.handle || null;
  if (!handle) {
    const user = await prisma.user.findUnique({ where: { id }, select: { handle: true } });
    handle = user?.handle ?? null;
  }
  redirect(handle ? `/u/${handle}` : '/learn');
}
