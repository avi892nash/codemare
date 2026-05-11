'use client';

import { useState } from 'react';
import type { Problem } from '@/lib/types';
import { ProblemExamples } from './ProblemExamples';
import { DifficultyPill, Pill, Tabs } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

/**
 * Middle pane of the problem-detail workspace. Receives the problem as a
 * prop from the server route (no client-side fetching) and owns only the
 * local tab state.
 */
export function ProblemDescription({ problem }: { problem: Problem }) {
  const [tab, setTab] = useState('Description');

  return (
    <aside
      className="cm scroll"
      style={{
        width: 460,
        flex: 'none',
        borderRight: '1px solid var(--line-2)',
        background: 'var(--bg-0)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ padding: '12px 18px 0', borderBottom: '1px solid var(--line-2)', flex: 'none' }}>
        <Tabs
          tabs={[
            { value: 'Description', label: 'Description' },
            { value: 'Editorial', label: 'Editorial' },
            { value: 'Discussion', label: 'Discussion' },
            { value: 'Submissions', label: 'Submissions' },
          ]}
          value={tab}
          onChange={setTab}
          size="sm"
        />
      </div>

      <div className="scroll" style={{ overflow: 'auto', padding: '20px 22px 32px', flex: 1, minHeight: 0 }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 21, fontWeight: 600, letterSpacing: -0.3, color: 'var(--fg-0)' }}>
          {problem.title}
        </h2>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <DifficultyPill level={problem.difficulty} />
          <span style={{ flex: 1 }} />
          <button
            style={{
              background: 'transparent', border: 'none', color: 'var(--fg-2)',
              cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12,
            }}
          >
            <Icon name="bookmark" size={13} /> Save
          </button>
        </div>

        {tab === 'Description' && (
          <>
            <div style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--fg-1)', marginBottom: 22 }}>
              {problem.description.split('\n\n').map((para, i) => (
                <p key={i} style={{ margin: '0 0 14px' }}>{para}</p>
              ))}
            </div>

            {problem.examples.length > 0 && (
              <>
                <SectionHeading>Examples</SectionHeading>
                <ProblemExamples examples={problem.examples} />
              </>
            )}

            {problem.constraints.length > 0 && (
              <>
                <SectionHeading>Constraints</SectionHeading>
                <ul className="mono" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--fg-1)', lineHeight: 1.9 }}>
                  {problem.constraints.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {tab !== 'Description' && (
          <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
            <Pill tone="muted" size="sm">Coming soon</Pill>
            <p style={{ margin: '12px 0 0', fontSize: 12.5 }}>{tab} are not yet available for this problem.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: '24px 0 10px',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: 'var(--fg-3)',
    }}>{children}</h3>
  );
}
