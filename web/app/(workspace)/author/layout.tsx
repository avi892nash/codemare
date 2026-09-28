import type { Metadata } from 'next';
import { authorViewer, NOT_FOUND_METADATA, requireAuthor } from './viewer';

/** Authoring tools are never indexed (robots.ts disallows /author too). */
export async function generateMetadata(): Promise<Metadata> {
  if (!(await authorViewer())) return NOT_FOUND_METADATA;
  return { title: 'Author · Codemare', robots: { index: false, follow: false } };
}

/** /author/* needs role ≥ author (spec §3.9); everyone else gets a plain 404. */
export default async function AuthorLayout({ children }: { children: React.ReactNode }) {
  await requireAuthor();
  return children;
}
