import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from '@/auth';
import { signInHref } from '@/components/Auth/routes';
import { SubmissionDetail } from '@/components/Submissions/SubmissionDetail';
import { subjectTitle } from '@/components/Submissions/SubmissionRows';
import { VERDICT_LABEL } from '@/lib/types';
import { getSubmissionView } from '@/lib/server/submissionHistory';

type Params = Promise<{ id: string }>;

/** One lookup per request, shared by generateMetadata and the page. */
const loadView = cache(async (id: string) => {
  const session = await auth();
  if (!session?.user?.id) return { signedIn: false as const, view: null };
  return { signedIn: true as const, view: await getSubmissionView(session.user.id, id) };
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { view } = await loadView((await params).id);
  if (!view) return { title: 'Submission not found · Codemare', robots: { index: false } };
  const verdict = view.status === 'queued' || view.status === 'running' ? 'Pending' : VERDICT_LABEL[view.status];
  return { title: `${verdict} · ${subjectTitle(view.subject)} · Codemare`, robots: { index: false } };
}

/**
 * 05 · /submissions/[id]. Visible to its owner and to staff+; everyone else
 * gets the 404 (never a 403, so ids cannot be probed).
 */
export default async function SubmissionPage({ params }: { params: Params }) {
  const { id } = await params;
  const { signedIn, view } = await loadView(id);
  if (!signedIn) redirect(signInHref(`/submissions/${encodeURIComponent(id)}`));
  if (!view) notFound();
  return <SubmissionDetail view={view} now={new Date()} />;
}
