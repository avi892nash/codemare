import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Avatar, Pill, DifficultyPill, fmtTime, fmtMem } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata = { title: 'Profile · Codemare' };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/auth?next=/profile');

  const userId = session.user.id;
  const [user, totals, recent] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }).catch(() => null),
    prisma.submission
      .groupBy({
        by: ['status'],
        where: { userId },
        _count: { status: true },
      })
      .catch(() => []),
    prisma.submission
      .findMany({
        where: { userId, status: 'OK' },
        select: { runMs: true, memoryKb: true, problem: { select: { difficulty: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      .catch(() => []),
  ]);

  const okCount = totals.find((t) => t.status === 'OK')?._count.status ?? 0;
  const totalCount = totals.reduce((acc, t) => acc + t._count.status, 0);

  const byDifficulty: Record<'Easy' | 'Medium' | 'Hard', number> = {
    Easy: 0,
    Medium: 0,
    Hard: 0,
  };
  for (const r of recent) byDifficulty[r.problem.difficulty]++;

  const fastest = recent.reduce<{ runMs: number | null; memoryKb: number | null }>(
    (best, r) => {
      if (r.runMs == null) return best;
      if (best.runMs == null || r.runMs < best.runMs) return { runMs: r.runMs, memoryKb: r.memoryKb };
      return best;
    },
    { runMs: null, memoryKb: null }
  );
  const [fT, fTu] = fmtTime(fastest.runMs);
  const [fM, fMu] = fmtMem(fastest.memoryKb);

  return (
    <main
      className="scroll"
      style={{ flex: 1, overflowY: 'auto', padding: '32px 48px', background: 'var(--bg-0)' }}
    >
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Identity card */}
        <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar name={user?.name ?? user?.email ?? 'You'} size={56} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>
              {user?.name ?? user?.email ?? 'You'}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--fg-3)' }}>
              {user?.handle ? <span className="mono">@{user.handle}</span> : <span>No handle set</span>}
              {user?.email && <> · <span className="mono">{user.email}</span></>}
            </p>
          </div>
          <SignOutButton />
        </div>

        {/* Stats grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          <StatCard label="Accepted" value={String(okCount)} subtitle={`/ ${totalCount} runs`} tone="ok" />
          <StatCard
            label="Acceptance"
            value={totalCount > 0 ? `${Math.round((okCount / totalCount) * 100)}%` : '—'}
            tone="accent"
          />
          <StatCard
            label="Fastest run"
            value={fastest.runMs == null ? '—' : `${fT} ${fTu}`}
            subtitle={fastest.memoryKb == null ? '' : `${fM} ${fMu}`}
          />
          <StatCard
            label="By difficulty"
            value={`${byDifficulty.Easy}·${byDifficulty.Medium}·${byDifficulty.Hard}`}
            subtitle="E · M · H"
          />
        </div>

        {/* Difficulty pills */}
        <div className="card" style={{ padding: 20 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--fg-3)',
              letterSpacing: 1.6,
              textTransform: 'uppercase',
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            Last 50 accepted
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <DifficultyPill level="Easy" />
            <span className="mono" style={{ fontSize: 13, color: 'var(--fg-1)' }}>{byDifficulty.Easy}</span>
            <span style={{ width: 1, height: 16, background: 'var(--line-2)', margin: '0 8px' }} />
            <DifficultyPill level="Medium" />
            <span className="mono" style={{ fontSize: 13, color: 'var(--fg-1)' }}>{byDifficulty.Medium}</span>
            <span style={{ width: 1, height: 16, background: 'var(--line-2)', margin: '0 8px' }} />
            <DifficultyPill level="Hard" />
            <span className="mono" style={{ fontSize: 13, color: 'var(--fg-1)' }}>{byDifficulty.Hard}</span>
          </div>
          {recent.length === 0 && (
            <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--fg-3)' }}>
              <Pill tone="muted" size="xs">Tip</Pill>
              <span style={{ marginLeft: 8 }}>Solve a problem to populate your stats.</span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label, value, subtitle, tone,
}: { label: string; value: string; subtitle?: string; tone?: 'ok' | 'accent' }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'accent' ? 'var(--accent-hi)' : 'var(--fg-0)';
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          fontSize: 10.5,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 500,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Icon name="trend" size={11} />
        {label}
      </div>
      <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 500, letterSpacing: -0.5, color }}>{value}</span>
        {subtitle && <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{subtitle}</span>}
      </div>
    </div>
  );
}
