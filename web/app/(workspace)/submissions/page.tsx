import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { DifficultyPill, Pill, StatusPill, fmtMem, fmtTime, LangMark } from '@/components/ui/primitives';
import type { StatusCode } from '@/components/ui/StatusPill';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Submissions · Codemare' };

export default async function SubmissionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth?next=/submissions');

  const submissions = await prisma.submission
    .findMany({
      where: { userId: session.user.id },
      include: { problem: { select: { slug: true, title: true, difficulty: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    .catch(() => []);

  return (
    <main
      className="scroll"
      style={{ flex: 1, overflowY: 'auto', padding: '32px 48px', background: 'var(--bg-0)' }}
    >
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-3)',
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          History
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: -0.4 }}>
          Submissions
        </h1>
        <p style={{ margin: '4px 0 28px', fontSize: 13, color: 'var(--fg-2)' }}>
          Last 100 runs across every problem.
        </p>

        {submissions.length === 0 ? (
          <EmptyState />
        ) : (
          <SubmissionsTable submissions={submissions as SubmissionRow[]} />
        )}
      </div>
    </main>
  );
}

type SubmissionRow = {
  id: string;
  status: StatusCode;
  language: 'python' | 'javascript' | 'cpp' | 'java';
  runMs: number | null;
  memoryKb: number | null;
  totalPassed: number;
  totalTests: number;
  createdAt: Date;
  problem: { slug: string; title: string; difficulty: 'Easy' | 'Medium' | 'Hard' };
};

function SubmissionsTable({ submissions }: { submissions: SubmissionRow[] }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '90px 1fr 100px 90px 110px 110px 110px',
          padding: '10px 14px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--fg-3)',
          borderBottom: '1px solid var(--line-2)',
          background: 'var(--bg-2)',
        }}
      >
        <span>Status</span>
        <span>Problem</span>
        <span>Difficulty</span>
        <span>Lang</span>
        <span>Runtime</span>
        <span>Memory</span>
        <span>When</span>
      </div>
      {submissions.map((s) => {
        const [t, tu] = fmtTime(s.runMs);
        const [m, mu] = fmtMem(s.memoryKb);
        return (
          <Link
            key={s.id}
            href={`/p/${s.problem.slug}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '90px 1fr 100px 90px 110px 110px 110px',
              padding: '10px 14px',
              fontSize: 13,
              borderBottom: '1px solid var(--line-1)',
              color: 'var(--fg-0)',
              textDecoration: 'none',
              alignItems: 'center',
            }}
          >
            <StatusPill code={s.status} size="sm" />
            <span>{s.problem.title}</span>
            <DifficultyPill level={s.problem.difficulty} size="xs" />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LangMark lang={s.language} />
              <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{s.language}</span>
            </span>
            <span className="mono" style={{ color: 'var(--fg-1)' }}>
              {t}
              <span style={{ color: 'var(--fg-3)' }}> {tu}</span>
            </span>
            <span className="mono" style={{ color: 'var(--fg-1)' }}>
              {m}
              <span style={{ color: 'var(--fg-3)' }}> {mu}</span>
            </span>
            <span style={{ color: 'var(--fg-3)', fontSize: 12 }}>{relativeTime(s.createdAt)}</span>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card" style={{ padding: 48, textAlign: 'center' }}>
      <Icon name="history" size={28} style={{ color: 'var(--fg-4)', marginBottom: 12 }} />
      <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-1)' }}>No submissions yet.</p>
      <p style={{ margin: '4px 0 16px', fontSize: 12.5, color: 'var(--fg-3)' }}>
        Solve a problem and your runs land here.
      </p>
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          fontSize: 13,
          background: 'var(--accent)',
          color: '#0b0a14',
          borderRadius: 'var(--r)',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        Browse problems <Icon name="arrow-right" size={13} />
      </Link>
      <div style={{ marginTop: 20 }}>
        <Pill tone="muted" size="xs">Tip</Pill>
        <span style={{ fontSize: 11.5, color: 'var(--fg-3)', marginLeft: 8 }}>
          Submissions are persisted to Postgres only when the DB is reachable; runs from a
          DB-less dev environment won&apos;t appear here.
        </span>
      </div>
    </div>
  );
}

function relativeTime(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(date).toISOString().slice(0, 10);
}
