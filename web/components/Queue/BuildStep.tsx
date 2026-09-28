'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type ComponentProps, type ReactNode } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { Modal } from '@/components/ui/Modal';
import { SolveWorkspace } from '@/components/Workspace/SolveWorkspace';
import { languageLabel } from '@/lib/client/languages';
import type { RunKind } from '@/lib/client/runState';
import type { QueueView } from '@/lib/server/queue';
import type { VerdictEventData } from '@/lib/sse';
import type { SupportedLanguage } from '@/lib/types';
import { QueueList } from './QueueList';
import { refreshKeepingStep, useStepVisit } from './stepRefresh';
import s from './queue.module.css';

type WorkspaceProps = ComponentProps<typeof SolveWorkspace>;

export interface BuildStepProps {
  /** What loadBuildStep returns, minus the prompt (rendered on the server as `statement`). */
  problem: WorkspaceProps['problem'];
  statement: ReactNode;
  build: NonNullable<WorkspaceProps['build']>;
  hints: WorkspaceProps['hints'];
  latestCode: WorkspaceProps['latestCode'];
  passed: boolean;
  component: { slug: string; title: string; topicTitle: string };
  step: { index: number; count: number };
  /** Direct dependencies and the languages the learner has them in. */
  dependencies: { slug: string; title: string; builtLanguages: SupportedLanguage[] }[];
  /** The queue's next step after this one. */
  next: { href: string; title: string; kind: 'predict' | 'build' } | null;
  queue: QueueView;
}

/**
 * T2b — Build: the solving workspace in build mode (judged by /api/build
 * with the learner's own dependencies prepended; the hint ladder in its
 * Hints tab), under a queue bar. A passing build marks the step, saves the
 * version to My Library and advances the queue; "Next" moves on.
 */
export function BuildStep(props: BuildStepProps) {
  const { problem, component, step, dependencies, next, queue } = props;
  const router = useRouter();
  const [justPassed, setJustPassed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const passed = props.passed || justPassed;
  useStepVisit(problem.id, props.passed);

  const onVerdict = useCallback(
    (verdict: VerdictEventData, kind: RunKind) => {
      if (kind !== 'build' || verdict.status !== 'OK') return;
      setJustPassed(true);
      // Re-render from the server around this step: the queue advances, the navbar's token total updates.
      void refreshKeepingStep(router, problem.id);
    },
    [router, problem.id]
  );

  return (
    <div className={s.buildRoot}>
      <div className={s.bar} data-passed={passed || undefined} role="region" aria-label="Queue" data-testid="queue-bar">
        <span className={s.barCrumb}>
          <Icon name="layers" size={14} />
          <Link href="/queue" className="focus-ring">
            Queue
          </Link>
          <Icon name="chev-right" size={11} />
          <strong>{component.title}</strong>
          <span>
            · step {step.index} of {step.count} · build
          </span>
        </span>
        {dependencies.length > 0 && (
          <span className={s.barDeps}>
            uses your
            {dependencies.map((d) => (
              <span key={d.slug} className={s.depChip} title={d.builtLanguages.length ? `Built in ${d.builtLanguages.map(languageLabel).join(', ')}` : 'Not built yet'}>
                {d.title}
                {d.builtLanguages.map((l) => (
                  <LangMark key={l} lang={l} size={11} />
                ))}
                <span className="sr-only">
                  {d.builtLanguages.length ? ` (built in ${d.builtLanguages.map(languageLabel).join(', ')})` : ' (not built yet)'}
                </span>
              </span>
            ))}
          </span>
        )}
        <span className={s.barSpacer} />
        {passed && (
          <span className={s.barPassed} role="status" data-testid="build-passed">
            <Icon name="check-circle" size={14} /> Built —{' '}
            <Link href={`/me/library#component-${component.slug}`} className="focus-ring">
              in your library
            </Link>
          </span>
        )}
        {next ? (
          <span className={s.barNext}>
            {!passed && <span>Up next:</span>}
            <ButtonLink
              href={next.href}
              size="sm"
              variant={passed ? 'primary' : 'ghost'}
              iconRight="arrow-right"
              data-testid="build-next"
              aria-label={`Next step: ${next.title}`}
            >
              <span className={s.barNextTitle}>{passed ? `Next: ${next.title}` : next.title}</span>
            </ButtonLink>
          </span>
        ) : (
          passed && (
            <ButtonLink href="/queue" size="sm" variant="primary" iconRight="arrow-right">
              Back to the queue
            </ButtonLink>
          )
        )}
        <Button size="sm" variant="default" icon="list" onClick={() => setListOpen(true)} aria-haspopup="dialog">
          Queue <span className="mono">{queue.upNext.length}</span>
        </Button>
      </div>

      <SolveWorkspace
        mode="build"
        problem={problem}
        statement={props.statement}
        build={props.build}
        hints={props.hints}
        latestCode={props.latestCode}
        solved={props.passed}
        onVerdict={onVerdict}
      />

      <Modal open={listOpen} onClose={() => setListOpen(false)} title="Your queue" description="Steps in dependency order — a component waits until what it calls is built." size="md">
        <QueueList queue={queue} focusId={problem.id} idPrefix="qm" />
      </Modal>
    </div>
  );
}
