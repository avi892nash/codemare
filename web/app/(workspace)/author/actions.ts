'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import {
  canAuthor,
  deleteDraft,
  getAuthorViewer,
  publishQuestion,
  runReference,
  saveDraft,
  unpublishQuestion,
  type AuthorViewer,
  type PublishResult,
  type ReferenceRunResult,
  type SaveResult,
} from '@/lib/server/author';

/**
 * Authoring server actions. Each one re-derives the viewer from the session
 * and the database (role ≥ author), then hands the raw, untrusted input to
 * lib/server/author.ts, which validates it with zod and enforces ownership
 * (author_id = viewer, or staff+). Callers without the role get the same
 * "not found" the pages give them.
 */

async function viewer(): Promise<AuthorViewer | null> {
  const session = await auth().catch(() => null);
  const v = await getAuthorViewer(session?.user?.id);
  return v && canAuthor(v.role) ? v : null;
}

const notFound = { ok: false as const, code: 'not_found' as const, error: 'Not found' };

function revalidate(id: string, slug: string) {
  revalidatePath('/author');
  revalidatePath(`/author/${id}/edit`);
  revalidatePath('/problems');
  revalidatePath(`/problems/${slug}`);
}

export async function saveDraftAction(draft: unknown): Promise<SaveResult> {
  const v = await viewer();
  if (!v) return notFound;
  const result = await saveDraft(v, draft);
  if (result.ok) revalidate(result.id, result.slug);
  return result;
}

export async function publishAction(draft: unknown): Promise<PublishResult> {
  const v = await viewer();
  if (!v) return notFound;
  const result = await publishQuestion(v, draft);
  if (result.ok) revalidate(result.id, result.slug);
  return result;
}

export async function unpublishAction(id: unknown): Promise<SaveResult> {
  const v = await viewer();
  if (!v || typeof id !== 'string') return notFound;
  const result = await unpublishQuestion(v, id);
  if (result.ok) revalidate(result.id, result.slug);
  return result;
}

export async function deleteDraftAction(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = await viewer();
  if (!v || typeof id !== 'string') return { ok: false, error: 'Not found' };
  const result = await deleteDraft(v, id);
  if (result.ok) revalidatePath('/author');
  return result;
}

export async function runReferenceAction(input: unknown): Promise<ReferenceRunResult> {
  const v = await viewer();
  if (!v) return notFound;
  return runReference(v, input);
}
