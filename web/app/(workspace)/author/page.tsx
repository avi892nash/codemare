import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Pill } from '@/components/ui/Pill';
import { EmptyState } from '@/components/states/EmptyState';
import { hasRole } from '@/lib/server/rules/roles';
import { listAuthoredQuestions } from '@/lib/server/author';
import s from '@/components/Author/author.module.css';
import { requireAuthor } from './viewer';

export const dynamic = 'force-dynamic';

function updated(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** /author — the questions you author (staff: every question, with ?scope=all). */
export default async function AuthorHome({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const viewer = await requireAuthor();
  const staff = hasRole(viewer.role, 'staff');
  const scope = staff && (await searchParams).scope === 'all' ? 'all' : 'mine';
  const rows = await listAuthoredQuestions(viewer, scope);
  const drafts = rows.filter((r) => r.status === 'draft').length;

  return (
    <main className={`${s.page} scroll`}>
      <div className={s.wrap} style={{ maxWidth: 1100 }}>
        <header className={s.head}>
          <div>
            <p className={s.eyebrow}>Author</p>
            <h1 className={s.title}>{scope === 'all' ? 'All questions' : 'My questions'}</h1>
            <p className={s.sub}>
              {rows.length === 0
                ? 'Write a problem, prove it with a reference solution, publish it to the catalog.'
                : `${rows.length} question${rows.length === 1 ? '' : 's'} · ${drafts} draft${drafts === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className={s.headActions}>
            <ButtonLink href="/author/new" variant="primary" icon="plus">
              New question
            </ButtonLink>
          </div>
        </header>

        {staff && (
          <nav aria-label="Which questions" className={s.row} style={{ marginBottom: 14 }}>
            <ButtonLink
              href="/author"
              size="sm"
              variant={scope === 'mine' ? 'default' : 'ghost'}
              aria-current={scope === 'mine' ? 'page' : undefined}
            >
              Mine
            </ButtonLink>
            <ButtonLink
              href="/author?scope=all"
              size="sm"
              variant={scope === 'all' ? 'default' : 'ghost'}
              aria-current={scope === 'all' ? 'page' : undefined}
            >
              All questions
            </ButtonLink>
          </nav>
        )}

        {rows.length === 0 ? (
          <div className={s.tableWrap}>
            <EmptyState
              icon="edit"
              title="No questions yet"
              description="Start with a title and a statement — the editor walks you through tests, a reference solution and the hint ladder."
              action={
                <ButtonLink href="/author/new" variant="primary" icon="plus">
                  Create your first question
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <div className={`${s.tableWrap} scroll`}>
            <table className={s.table}>
              <caption className="sr-only">{scope === 'all' ? 'All questions' : 'Questions you author'}</caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Difficulty</th>
                  <th scope="col">Status</th>
                  <th scope="col">Tests</th>
                  <th scope="col">Topics</th>
                  {scope === 'all' && <th scope="col">Author</th>}
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link href={`/author/${q.id}/edit`} className={`${s.qLink} focus-ring`}>
                        {q.title || 'Untitled question'}
                      </Link>
                      <span className={s.qSlug}>{q.slug}</span>
                    </td>
                    <td>
                      <DifficultyPill level={q.difficulty} />
                    </td>
                    <td>
                      <Pill tone={q.status === 'published' ? 'ok' : 'warn'} dot size="sm">
                        {q.status === 'published' ? 'Published' : 'Draft'}
                      </Pill>
                    </td>
                    <td className={`${s.nowrap} ${s.count}`}>
                      {q.tests} · {q.hiddenTests} hidden
                    </td>
                    <td className={s.topicsCell}>{q.topics.join(', ') || '—'}</td>
                    {scope === 'all' && <td className={s.count}>{q.authorHandle ? `@${q.authorHandle}` : 'seed'}</td>}
                    <td className={`${s.nowrap} ${s.count}`}>{updated(q.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
