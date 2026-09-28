import { redirect } from 'next/navigation';
import { firstParam } from '@/components/Auth/messages';
import { signInHref } from '@/components/Auth/routes';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Legacy /auth → /signin, keeping a safe `next`. */
export default async function LegacyAuthPage({ searchParams }: { searchParams: SearchParams }) {
  redirect(signInHref(firstParam((await searchParams).next)));
}
