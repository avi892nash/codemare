import type { Metadata } from 'next';
import { QuestionEditor } from '@/components/Author/QuestionEditor';
import { emptyDraft } from '@/components/Author/model';
import { listTagSuggestions, listTopicOptions } from '@/lib/server/author';
import { authorViewer, NOT_FOUND_METADATA, requireAuthor } from '../viewer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if (!(await authorViewer())) return NOT_FOUND_METADATA;
  return { title: 'New question · Codemare', robots: { index: false, follow: false } };
}

/** /author/new — a blank editor; the first save creates the draft and moves to /author/[id]/edit. */
export default async function NewQuestionPage() {
  await requireAuthor();
  const [topics, suggestions] = await Promise.all([listTopicOptions(), listTagSuggestions()]);
  return (
    <QuestionEditor
      initial={emptyDraft()}
      meta={{ status: 'draft', updatedAt: null, authorHandle: null }}
      topics={topics}
      suggestions={suggestions}
    />
  );
}
