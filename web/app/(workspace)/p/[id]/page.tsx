import { notFound } from 'next/navigation';
import { compile, CompileServiceError } from '@/lib/compile';
import { CatalogList } from '@/components/Catalog/CatalogList';
import { ProblemDescription } from '@/components/Problem/ProblemDescription';
import { EditorWorkspace } from '@/components/Editor/EditorWorkspace';

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
      <EditorWorkspace problem={problem} />
    </>
  );
}
