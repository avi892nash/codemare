import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { canAuthor, getAuthorViewer, type AuthorViewer } from '@/lib/server/author';

/** The signed-in user if they may author (role ≥ author, read fresh from the database). */
export async function authorViewer(): Promise<AuthorViewer | null> {
  const session = await auth().catch(() => null);
  const viewer = await getAuthorViewer(session?.user?.id);
  return viewer && canAuthor(viewer.role) ? viewer : null;
}

/**
 * The signed-in author, or a plain 404 — the same page an unknown URL gets.
 * Every /author page calls this itself: layouts render in parallel with
 * pages, so a layout check alone would not stop a page from loading data.
 */
export async function requireAuthor(): Promise<AuthorViewer> {
  const viewer = await authorViewer();
  if (!viewer) notFound();
  return viewer;
}

/** Exactly what app/not-found.tsx declares, so a denied page looks like any unknown URL. */
export const NOT_FOUND_METADATA: Metadata = { title: 'Not found · Codemare', robots: { index: false } };
