'use client';

import { useState } from 'react';
import type { IdeTestCase } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

interface TestCaseManagerProps {
  testCases: IdeTestCase[];
  onTestCasesChange: (testCases: IdeTestCase[]) => void;
  maxTestCases?: number;
}

export function TestCaseManager({
  testCases,
  onTestCasesChange,
  maxTestCases = 10,
}: TestCaseManagerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const addTest = () => {
    if (testCases.length >= maxTestCases) return;
    onTestCasesChange([...testCases, { input: '', expectedOutput: '' }]);
    setExpandedIndex(testCases.length);
  };

  const removeTest = (index: number) => {
    if (testCases.length <= 1) return;
    const next = testCases.filter((_, i) => i !== index);
    onTestCasesChange(next);
    if (expandedIndex === index) setExpandedIndex(0);
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const updateTest = (index: number, field: 'input' | 'expectedOutput', value: string) => {
    const next = [...testCases];
    next[index] = { ...next[index], [field]: value };
    onTestCasesChange(next);
  };

  return (
    <div className="cm scroll" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-1)', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: '1px solid var(--line-2)', flex: 'none',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--fg-0)', letterSpacing: -0.1 }}>Test cases</h3>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>{testCases.length} / {maxTestCases}</span>
        </div>
        <Button size="sm" variant="default" icon="plus" onClick={addTest} disabled={testCases.length >= maxTestCases}>
          Add
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }} className="scroll">
        {testCases.map((tc, i) => {
          const expanded = expandedIndex === i;
          return (
            <div key={i} style={{ borderBottom: '1px solid var(--line-1)' }}>
              <button
                onClick={() => setExpandedIndex(expanded ? null : i)}
                className="focus-ring"
                style={{
                  width: '100%', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px',
                  background: expanded ? 'var(--bg-2)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: 'var(--fg-0)', fontSize: 12.5, fontWeight: 500,
                }}
              >
                <Icon name={expanded ? 'chev-down' : 'chev-right'} size={12} style={{ color: 'var(--fg-3)' }} />
                <span style={{ flex: 1 }}>Test case {i + 1}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeTest(i); }}
                  disabled={testCases.length <= 1}
                  title="Remove"
                  style={{
                    width: 22, height: 22, borderRadius: 4,
                    background: 'transparent', border: 'none',
                    color: testCases.length <= 1 ? 'var(--fg-4)' : 'var(--fg-2)',
                    cursor: testCases.length <= 1 ? 'not-allowed' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </button>

              {expanded && (
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Field label="Input (stdin)" hint="Data to be sent to stdin">
                    <textarea
                      value={tc.input}
                      onChange={(e) => updateTest(i, 'input', e.target.value)}
                      placeholder="2&#10;3"
                      rows={3}
                      className="mono"
                      style={ taStyle }
                    />
                  </Field>
                  <Field label="Expected output (stdout)" hint="Exact match">
                    <textarea
                      value={tc.expectedOutput}
                      onChange={(e) => updateTest(i, 'expectedOutput', e.target.value)}
                      placeholder="5"
                      rows={3}
                      className="mono"
                      style={ taStyle }
                    />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const taStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--fg-0)',
  fontFamily: 'var(--font-mono)',
  outline: 'none',
  resize: 'vertical',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginBottom: 4, letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 500 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}
