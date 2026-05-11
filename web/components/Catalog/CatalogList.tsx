'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProblemListItem } from '@/lib/types';
import { DifficultyPill, Input, Pill, StatusDot } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

/**
 * Catalog rendering + search. Receives the full problem list from the server
 * component above so first paint is SSR; the filter is client-side, instant.
 */
export function CatalogList({ problems }: { problems: ProblemListItem[] }) {
  const [search, setSearch] = useState('');
  const filtered = problems.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div
      className="cm scroll"
      style={{
        width: 320,
        flex: 'none',
        borderRight: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid var(--line-2)',
          background: 'var(--bg-1)',
        }}
      >
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
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            No problems match your filters.
          </div>
        )}
        {filtered.map((problem) => (
          <Link
            key={problem.id}
            href={`/p/${problem.id}`}
            className="focus-ring"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderBottom: '1px solid var(--line-1)',
              borderLeft: '2px solid transparent',
              color: 'var(--fg-0)',
              textDecoration: 'none',
            }}
          >
            <StatusDot status="unsolved" />
            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{problem.title}</span>
            <DifficultyPill level={problem.difficulty} size="xs" />
          </Link>
        ))}
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
