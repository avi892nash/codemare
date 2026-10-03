'use client';

import { useState } from 'react';
import type { IdeTestCase } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Textarea } from '@/components/ui/Input';
import s from './IDE.module.css';

interface TestCaseManagerProps {
  testCases: IdeTestCase[];
  onTestCasesChange: (testCases: IdeTestCase[]) => void;
  maxTestCases?: number;
}

/**
 * The IDE's stdin cases: an accordion of cases, each with stdin and an
 * optional expected stdout. Each row header holds two sibling controls — the
 * disclosure button (label + peek) and the remove button — because an
 * interactive element can't contain another one.
 */
export function TestCaseManager({ testCases, onTestCasesChange, maxTestCases = 10 }: TestCaseManagerProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const addTest = () => {
    if (testCases.length >= maxTestCases) return;
    onTestCasesChange([...testCases, { input: '', expectedOutput: '' }]);
    setExpandedIndex(testCases.length);
  };

  const removeTest = (index: number) => {
    if (testCases.length <= 1) return;
    onTestCasesChange(testCases.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(0);
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const updateTest = (index: number, field: 'input' | 'expectedOutput', value: string) => {
    onTestCasesChange(testCases.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)));
  };

  return (
    <div className={s.manager} data-testid="ide-cases">
      <div className={s.managerHead}>
        <div>
          <h2 className={s.managerTitle}>Test cases</h2>
          <span className={s.managerCount}>
            {testCases.length} of {maxTestCases}
          </span>
        </div>
        <Button size="sm" icon="plus" onClick={addTest} disabled={testCases.length >= maxTestCases}>
          Add
        </Button>
      </div>

      <div className={`${s.managerList} scroll`}>
        {testCases.map((tc, i) => {
          const expanded = expandedIndex === i;
          const toggle = () => setExpandedIndex(expanded ? null : i);
          return (
            <div key={i} className={s.case} data-expanded={expanded || undefined}>
              <div className={s.caseHead}>
                <button type="button" aria-expanded={expanded} onClick={toggle} className={`${s.caseToggle} focus-ring`}>
                  <Icon name={expanded ? 'chev-down' : 'chev-right'} size={12} />
                  <span className={s.caseName}>Case {i + 1}</span>
                  {!expanded && tc.input && <span className={`${s.casePeek} mono`}>{tc.input.replace(/\n/g, ' ⏎ ')}</span>}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="x"
                  aria-label={`Remove case ${i + 1}`}
                  disabled={testCases.length <= 1}
                  onClick={() => removeTest(i)}
                  className={s.removeBtn}
                />
              </div>

              {expanded && (
                <div className={s.caseBody}>
                  <Textarea
                    label="Input (stdin)"
                    value={tc.input}
                    onChange={(e) => updateTest(i, 'input', e.target.value)}
                    placeholder={'2\n3'}
                    rows={3}
                    mono
                    className={s.field}
                    data-testid={`ide-stdin-${i}`}
                  />
                  <Textarea
                    label="Expected output"
                    hint="Optional · compared line by line, trailing whitespace ignored"
                    value={tc.expectedOutput}
                    onChange={(e) => updateTest(i, 'expectedOutput', e.target.value)}
                    placeholder="5"
                    rows={2}
                    mono
                    className={s.field}
                    data-testid={`ide-expected-${i}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
