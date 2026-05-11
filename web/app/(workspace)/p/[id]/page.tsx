import { notFound } from 'next/navigation';
import { compile, CompileServiceError } from '@/lib/compile';
import { CatalogList } from '@/components/Catalog/CatalogList';
import { ProblemDescription } from '@/components/Problem/ProblemDescription';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const problem = await compile.getProblem(id);
    return { title: `${problem.title} · Codemare` };
  } catch {
    return { title: 'Problem · Codemare' };
  }
}

export default async function ProblemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let problem;
  let catalog;
  try {
    [problem, catalog] = await Promise.all([compile.getProblem(id), compile.listProblems()]);
  } catch (err) {
    if (err instanceof CompileServiceError && err.status === 404) notFound();
    throw err;
  }

  return (
    <>
      <CatalogList problems={catalog} />
      <ProblemDescription problem={problem} />
      <EditorPlaceholder />
    </>
  );
}

/**
 * Editor + Results pane is a follow-up commit (Monaco wrap + server action
 * proxying to compile.execute). Keeping the shell three-column so the layout
 * is locked in.
 */
function EditorPlaceholder() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)' }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-1)' }}>Editor coming online next commit.</p>
        <p style={{ margin: '4px 0 0', fontSize: 12 }}>
          Monaco + server action that calls the compile service with X-Codemare-Token.
        </p>
      </div>
    </div>
  );
}
