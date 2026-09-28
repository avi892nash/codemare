import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/** `/` has no page of its own: the catalog when signed in, else sign-in. */
export default async function Home() {
  const session = await auth().catch(() => null);
  redirect(session?.user ? '/problems' : '/signin');
}
