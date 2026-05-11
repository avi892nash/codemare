import { useState, useEffect } from 'react';
import { problemsApi } from '../../services/api';
import { ProblemListItem } from '../../types/problem';
import { useEditor } from '../../context/EditorContext';
import { DifficultyPill, Input, Pill, StatusDot } from '../ui/primitives';
import { Icon } from '../ui/Icon';

export function ProblemList() {
  const [problems, setProblems] = useState<ProblemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const { currentProblem, setCurrentProblem } = useEditor();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const data = await problemsApi.getAll();
        if (!cancelled) {
          setProblems(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load problems');
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleProblemClick = async (problemId: string) => {
    try {
      const problem = await problemsApi.getById(problemId);
      setCurrentProblem(problem);
    } catch (err) {
      console.error('Failed to load problem:', err);
    }
  };

  const filtered = problems.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="cm scroll" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid var(--line-2)', background: 'var(--bg-1)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-0)', letterSpacing: -0.2 }}>
            Problems
          </h2>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
            {filtered.length}/{problems.length}
          </span>
        </div>
        <Input
          icon="search"
          placeholder="Search problems"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          full
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} className="scroll">
        {loading && <RowSkeleton />}
        {error && (
          <div style={{ padding: 16, fontSize: 13, color: 'var(--err)' }}>{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            No problems match your filters.
          </div>
        )}
        {!loading && filtered.map((problem) => {
          const active = currentProblem?.id === problem.id;
          return (
            <button
              key={problem.id}
              onClick={() => handleProblemClick(problem.id)}
              className="focus-ring"
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 14px',
                background: active ? 'var(--accent-bg)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--line-1)',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--fg-0)',
              }}
            >
              <StatusDot status="unsolved" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: active ? 'var(--accent-hi)' : 'var(--fg-0)' }}>
                {problem.title}
              </span>
              <DifficultyPill level={problem.difficulty} size="xs" />
            </button>
          );
        })}
      </div>

      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Pill tone="muted" size="xs" icon="filter">All</Pill>
        <Pill tone="muted" size="xs">Unsolved</Pill>
        <span style={{ flex: 1 }} />
        <Icon name="settings" size={13} style={{ color: 'var(--fg-3)' }} />
      </div>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div style={{ padding: '10px 14px' }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div className="skel" style={{ width: 14, height: 14, borderRadius: 999 }} />
          <div className="skel" style={{ height: 12, flex: 1 }} />
          <div className="skel" style={{ height: 14, width: 50, borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}
