import type { Metadata } from 'next';
import { LIBRARY_ROBOTS, libraryViewer, NOT_FOUND_METADATA, requireLibraryViewer } from './viewer';

/**
 * The hidden Library. Never indexed (robots metadata here and on every
 * page, plus the Disallow in app/robots.ts); nothing links to it. Access:
 * role ≥ staff unless FEATURE_LIBRARY_PUBLIC=true — anyone else gets the
 * same 404 an unknown URL gets, with the same metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await libraryViewer())) return NOT_FOUND_METADATA;
  return { title: 'Library · Codemare', robots: LIBRARY_ROBOTS };
}

export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  await requireLibraryViewer();
  return children;
}
