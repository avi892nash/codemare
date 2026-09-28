import 'server-only';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { getLibraryViewer, type LibraryViewer } from '@/lib/server/library';

/** The signed-in user if the library is open to them (staff+, or anyone with FEATURE_LIBRARY_PUBLIC=true). */
export async function libraryViewer(): Promise<LibraryViewer | null> {
  const session = await auth().catch(() => null);
  return getLibraryViewer(session?.user?.id);
}

/**
 * The library viewer, or a plain 404 — identical to an unknown URL. Every
 * library page calls this itself (layouts render in parallel with pages).
 */
export async function requireLibraryViewer(): Promise<LibraryViewer> {
  const viewer = await libraryViewer();
  if (!viewer) notFound();
  return viewer;
}

/** Exactly what app/not-found.tsx declares: a denied request must not reveal the library exists. */
export const NOT_FOUND_METADATA: Metadata = { title: 'Not found · Codemare', robots: { index: false } };

/** Every library page: never indexed, never followed. */
export const LIBRARY_ROBOTS: Metadata['robots'] = { index: false, follow: false, nocache: true };
