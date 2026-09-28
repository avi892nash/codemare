import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { QuestionEditor } from '@/components/Author/QuestionEditor';
import { listTagSuggestions, listTopicOptions, loadQuestionDraft } from '@/lib/server/author';
import { authorViewer, NOT_FOUND_METADATA, requireAuthor } from '../../viewer';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const viewer = await authorViewer();
  const loaded = viewer ? await loadQuestionDraft(viewer, (await params).id) : null;
  if (!loaded) return NOT_FOUND_METADATA;
  return { title: `Edit · ${loaded.draft.title || 'Untitled'} · Codemare`, robots: { index: false, follow: false } };
}

/**
 * /author/[id]/edit — the question's author, or staff+. Anyone else (and
 * unknown ids) gets the same plain 404.
 */
export default async function EditQuestionPage({ params }: { params: Params }) {
  const viewer = await requireAuthor();
  const { id } = await params;
  const [loaded, topics, suggestions] = await Promise.all([
    loadQuestionDraft(viewer, id),
    listTopicOptions(),
    listTagSuggestions(),
  ]);
  if (!loaded) notFound();
  const { draft, meta } = loaded;
  const ownerNote =
    meta.authorHandle && meta.authorHandle !== viewer.handle
      ? `by @${meta.authorHandle} (editing as staff)`
      : !meta.authorHandle
        ? 'seeded question (editing as staff)'
        : null;
  return (
    <QuestionEditor
      key={draft.id}
      initial={draft}
      meta={meta}
      topics={topics}
      suggestions={suggestions}
      ownerNote={ownerNote}
    />
  );
}
