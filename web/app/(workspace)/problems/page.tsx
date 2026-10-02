import { redirect } from 'next/navigation';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The problem list that lived here was removed on 2026-10-02 at the owner's
 * request (decision 39): the map lists every topic's problems, so /problems
 * — old links and bookmarks, whatever filters their query string carries —
 * opens the map. `?topic=<slug>`, the map's old link to a topic's problems,
 * lands on that topic's card. /problems/[slug] is untouched.
 */
export default async function ProblemsRedirect({ searchParams }: { searchParams: SearchParams }) {
  const { topic } = await searchParams;
  const slug = typeof topic === 'string' ? topic.trim().toLowerCase() : '';
  redirect(TOPIC_SLUG.test(slug) ? `/map#topic-${slug}` : '/map');
}
