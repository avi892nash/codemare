import { useState } from 'react';
import { useEditor } from '../../context/EditorContext';
import { ProblemExamples } from './ProblemExamples';
import { DifficultyPill, Pill, Tabs } from '../ui/primitives';
import { Icon } from '../ui/Icon';

export function ProblemDescription() {
  const { currentProblem } = useEditor();
  const [tab, setTab] = useState('Description');

  if (!currentProblem) {
    return (
      <div className="cm" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
          <Icon name="layers" size={28} style={{ color: 'var(--fg-4)', marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-1)' }}>No problem selected</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>Pick one from the list to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <aside className="cm scroll" style={{
      height: '100%', background: 'var(--bg-0)',
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <div style={{ padding: '12px 18px 0', borderBottom: '1px solid var(--line-2)', flex: 'none' }}>
        <Tabs
          tabs={[
            { value: 'Description', label: 'Description' },
            { value: 'Editorial',   label: 'Editorial' },
            { value: 'Discussion',  label: 'Discussion' },
            { value: 'Submissions', label: 'Submissions' },
          ]}
          value={tab}
          onChange={setTab}
          size="sm"
        />
      </div>

      <div className="scroll" style={{ overflow: 'auto', padding: '20px 22px 32px', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: -0.3, color: 'var(--fg-0)' }}>
            {currentProblem.title}
          </h2>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
          <DifficultyPill level={currentProblem.difficulty} />
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
              {currentProblem.description.split('\n\n').map((para, i) => (
                <p key={i} style={{ margin: '0 0 14px' }}>{para}</p>
              ))}
            </div>

            {currentProblem.examples.length > 0 && (
              <>
                <SectionHeading>Examples</SectionHeading>
                <ProblemExamples examples={currentProblem.examples} />
              </>
            )}

            {currentProblem.constraints.length > 0 && (
              <>
                <SectionHeading>Constraints</SectionHeading>
                <ul className="mono" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--fg-1)', lineHeight: 1.9 }}>
                  {currentProblem.constraints.map((c, i) => (
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
