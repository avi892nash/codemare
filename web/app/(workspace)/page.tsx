import { Suspense } from 'react';
import { compile, CompileServiceError } from '@/lib/compile';
import { CatalogList } from '@/components/Catalog/CatalogList';
import { Icon } from '@/components/ui/Icon';

export const metadata = {
  title: 'Problems · Codemare',
};

export default async function CatalogPage() {
  let problems;
  let error: string | null = null;
  try {
    problems = await compile.listProblems();
  } catch (err) {
    error =
      err instanceof CompileServiceError
        ? `compile service responded ${err.status}`
        : err instanceof Error
          ? err.message
          : 'unknown error';
    problems = [];
  }

  return (
    <>
      <Suspense fallback={<div style={{ padding: 20, color: 'var(--fg-3)' }}>Loading catalog…</div>}>
        <CatalogList problems={problems} />
      </Suspense>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
          <Icon name="layers" size={28} style={{ color: 'var(--fg-4)', marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-1)' }}>
            {error ? 'Catalog unavailable' : 'No problem selected'}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>
            {error ?? 'Pick one from the list to get started.'}
          </p>
        </div>
      </div>
    </>
  );
}
