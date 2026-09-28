'use client';

import dynamic from 'next/dynamic';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { TabPanel, Tabs, type TabItem } from '@/components/ui/Tabs';
import { formatPercent } from '@/lib/client/format';
import type { HintLadderProps } from '@/components/Hints/HintLadder';
import { SubmissionsList } from './SubmissionsList';
import type { SubmissionSummary, WorkspaceMode, WorkspaceProblem } from './types';
import s from './Workspace.module.css';

// The ladder (and the markdown renderer it pulls in) loads when its tab opens.
const HintLadder = dynamic(() => import('@/components/Hints/HintLadder').then((m) => m.HintLadder), {
  ssr: false,
  loading: () => <p className={s.muted}>Loading hints…</p>,
});

type TabKey = 'description' | 'editorial' | 'submissions' | 'hints';

interface StatementPaneProps {
  mode: WorkspaceMode;
  problem: WorkspaceProblem;
  /** Eyebrow above the title (e.g. "Build · Prefix sums"). */
  eyebrow?: ReactNode;
  statement: ReactNode;
  editorial?: ReactNode;
  submissions?: SubmissionSummary[];
  hints?: Omit<HintLadderProps, 'solved'> | null;
  solved: boolean;
  bestPercentile?: number | null;
}

/**
 * The left pane: title row, then Description · Editorial · Submissions ·
 * Hints. A gate hides the editorial and hints (and a build shows its
 * prompt and hints). Panels mount on first open and stay mounted.
 */
export function StatementPane({ mode, problem, eyebrow, statement, editorial, submissions, hints, solved, bestPercentile }: StatementPaneProps) {
  const tabsId = useId();
  const [tab, setTab] = useState<TabKey>('description');
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(new Set(['description']));
  const [spoilers, setSpoilers] = useState(false);

  const tabs: TabItem[] = [{ value: 'description', label: mode === 'build' ? 'Prompt' : 'Description', icon: 'book' }];
  if (mode === 'question' && editorial) tabs.push({ value: 'editorial', label: 'Editorial', icon: 'book-open' });
  if (mode !== 'build' && submissions) tabs.push({ value: 'submissions', label: 'Submissions', icon: 'history', count: submissions.length || undefined });
  if (mode !== 'gate' && hints) tabs.push({ value: 'hints', label: 'Hints', icon: 'lightbulb' });

  const select = (v: string) => {
    const key = v as TabKey;
    setTab(key);
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const panel = (key: TabKey, node: ReactNode) =>
    visited.has(key) && (
      <div hidden={tab !== key} className={s.panelWrap}>
        <TabPanel tabsId={tabsId} value={key} className={s.panel}>
          {node}
        </TabPanel>
      </div>
    );

  return (
    <>
      <header className={s.statementHead}>
        {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
        <h1 className={s.problemTitle} data-testid="problem-title">
          {problem.title}
        </h1>
        <div className={s.titleMeta}>
          <DifficultyPill level={problem.difficulty} />
          {solved && (
            <Pill tone="ok" size="sm" icon="check-circle" data-testid="solved-pill">
              Solved
            </Pill>
          )}
          {bestPercentile != null && (
            <Pill tone="muted" size="sm" icon="trend" title="Your best runtime percentile on this problem">
              Best: beats {formatPercent(bestPercentile)}%
            </Pill>
          )}
        </div>
      </header>
      {tabs.length > 1 && (
        <div className={s.paneTabs}>
          <Tabs id={tabsId} tabs={tabs} value={tab} onChange={select} size="sm" aria-label="Problem sections" />
        </div>
      )}
      <div className={`${s.paneBody} scroll`}>
        {tabs.length > 1 ? (
          <>
            {panel('description', statement)}
            {panel(
              'editorial',
              solved || spoilers ? (
                editorial
              ) : (
                <div className={s.spoiler}>
                  <Icon name="eye-off" size={18} />
                  <p>The editorial walks through the solution. Try it yourself first — or reveal it anyway.</p>
                  <Button size="sm" icon="eye" onClick={() => setSpoilers(true)}>
                    Show the editorial
                  </Button>
                </div>
              )
            )}
            {panel('submissions', <SubmissionsList submissions={submissions ?? []} />)}
            {hints && panel('hints', <HintLadder {...hints} solved={solved} />)}
          </>
        ) : (
          <div className={s.panel}>{statement}</div>
        )}
      </div>
    </>
  );
}
