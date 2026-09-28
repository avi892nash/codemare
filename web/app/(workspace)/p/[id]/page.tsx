import { permanentRedirect } from 'next/navigation';

/** The old editor route: /p/<slug> → /problems/<slug> (spec §7), query string kept. */
export default async function LegacyProblemRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const qs = query.toString();
  permanentRedirect(`/problems/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
}
