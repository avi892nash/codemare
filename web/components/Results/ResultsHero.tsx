'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { MetricChip } from '@/components/ui/MetricChip';
import { Pill } from '@/components/ui/Pill';
import { Progress } from '@/components/ui/Progress';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatKb, formatLimit, formatMicros, formatMillis, formatPercent } from '@/lib/client/format';
import { languageLabel } from '@/lib/client/languages';
import type { RunKind } from '@/lib/client/runState';
import type { TestEventData, VerdictEventData } from '@/lib/sse';
import type { SupportedLanguage, Verdict } from '@/lib/types';
import { JudgeOutput } from './JudgeOutput';
import { TestStrip } from './TestStrip';
import s from './Results.module.css';

interface ResultsHeroProps {
  verdict: VerdictEventData;
  kind: RunKind;
  tests: TestEventData[];
  language: SupportedLanguage;
  /** Whole-run CPU limit, for the TLE explanation. */
  timeLimitMs?: number;
  onLine?: (line: number, column?: number) => void;
  /** Offered after all samples pass on a `run`. */
  onSubmit?: () => void;
  /** Extra actions for accepted submissions (AI review). */
  actions?: ReactNode;
  onSelectTest?: (idx: number) => void;
}

/** Per-verdict tone (spec §8 colors, via the StatusPill tones) and icon. */
const LOOK: Record<Verdict, { tone: 'ok' | 'err' | 'warn' | 'info' | 'muted'; icon: IconName }> = {
  OK: { tone: 'ok', icon: 'check-circle' },
  WA: { tone: 'err', icon: 'x' },
  RE: { tone: 'err', icon: 'alert' },
  TLE: { tone: 'warn', icon: 'clock' },
  MLE: { tone: 'warn', icon: 'memory' },
  CE: { tone: 'info', icon: 'code' },
  XX: { tone: 'muted', icon: 'alert-circle' },
};

function title(verdict: VerdictEventData, kind: RunKind): string {
  if (verdict.status === 'OK') return kind === 'submit' ? 'Accepted' : 'All tests passed';
  return {
    WA: 'Wrong Answer',
    RE: 'Runtime Error',
    TLE: 'Time Limit Exceeded',
    MLE: 'Memory Limit Exceeded',
    CE: 'Compilation Error',
    XX: 'Internal Error',
  }[verdict.status];
}

function summary(verdict: VerdictEventData, kind: RunKind, tests: TestEventData[], timeLimitMs?: number): string {
  const { status, totalPassed, totalTests } = verdict;
  const firstFail = tests.find((t) => !t.passed);
  const which = (t: TestEventData) => `test ${t.idx + 1}${t.hidden ? ' (hidden)' : t.custom ? ' (custom)' : ''}`;
  switch (status) {
    case 'OK':
      return kind === 'run'
        ? `${totalPassed} / ${totalTests} passed. Submit to judge against the hidden tests too.`
        : `${totalPassed} / ${totalTests} tests passed.`;
    case 'WA':
      return `${totalPassed} / ${totalTests} passed${firstFail ? ` — first wrong answer on ${which(firstFail)}` : ''}.`;
    case 'TLE': {
      const limit = timeLimitMs ? ` its ${formatLimit(timeLimitMs)} limit` : ' the time limit';
      return firstFail
        ? `${totalPassed} of ${totalTests} tests finished before the run hit${limit} on ${which(firstFail)}.`
        : `The run hit${limit}.`;
    }
    case 'MLE':
      return firstFail ? `Ran out of memory on ${which(firstFail)} (${totalPassed} / ${totalTests} passed before it).` : 'The run used too much memory.';
    case 'RE':
      return firstFail ? `Crashed on ${which(firstFail)} — ${totalPassed} / ${totalTests} passed before it.` : 'The program crashed.';
    case 'CE':
      return 'Your code didn’t compile — nothing ran. Click a line reference to jump to it.';
    case 'XX':
      return 'The judge couldn’t finish this run. It isn’t your code — try again.';
  }
}

/** The judge's advice for the slow and the crashing. */
function advice(status: Verdict): string | null {
  if (status === 'TLE') return 'Correct on what finished, but too slow for the largest inputs. Look for an asymptotically faster approach — the constraints say which complexity fits.';
  if (status === 'MLE') return 'Look for a structure that doesn’t keep every intermediate result, or an in-place approach.';
  return null;
}

/**
 * The results hero (artboard 03): verdict in its spec color, runtime in µs,
 * memory, compile time, "Beats N%", tokens and badges earned, and the test
 * strip. Accepted and TLE get their own composition, not just a color.
 */
export function ResultsHero({ verdict, kind, tests, language, timeLimitMs, onLine, onSubmit, actions, onSelectTest }: ResultsHeroProps) {
  const look = LOOK[verdict.status];
  const runtime = formatMicros(verdict.runtimeUs);
  const memory = formatKb(verdict.memoryKb);
  const compile = formatMillis(verdict.compileMs);
  const ok = verdict.status === 'OK';
  const ranTests = verdict.status !== 'CE' && tests.length > 0;
  const tip = advice(verdict.status);
  const earned = (verdict.tokensAwarded?.length ?? 0) > 0 || (verdict.badgesAwarded?.length ?? 0) > 0;

  return (
    <section className={s.hero} data-tone={look.tone} data-status={verdict.status} aria-labelledby="verdict-title" data-testid="results-hero">
      <div className={s.heroTop}>
        <span className={s.heroIcon} aria-hidden="true">
          <Icon name={look.icon} size={20} strokeWidth={2} />
        </span>
        <div className={s.heroHeading}>
          <h2 id="verdict-title" className={s.heroTitle} data-testid="verdict-title">
            {title(verdict, kind)}
          </h2>
          <p className={s.heroSummary}>{summary(verdict, kind, tests, timeLimitMs)}</p>
        </div>
        <div className={s.heroPills}>
          <StatusPill code={verdict.status} size="md" withIcon />
          <Pill size="sm" tone="muted">
            {languageLabel(language)}
          </Pill>
        </div>
      </div>

      {ranTests && (
        <div className={s.metrics} data-testid="verdict-metrics">
          <MetricChip
            size="lg"
            icon="zap"
            label={verdict.status === 'TLE' ? `Runtime · ${verdict.totalPassed} finished` : 'Runtime'}
            value={runtime.value}
            unit={runtime.unit}
          />
          {verdict.status === 'TLE' && timeLimitMs ? (
            <MetricChip size="lg" icon="clock" label="Limit" value={formatLimit(timeLimitMs).split(' ')[0]} unit={formatLimit(timeLimitMs).split(' ')[1]} />
          ) : null}
          <MetricChip size="lg" icon="memory" label="Memory" value={memory.value} unit={memory.unit} />
          {verdict.compileMs != null && <MetricChip size="lg" icon="cpu" label="Compile" value={compile.value} unit={compile.unit} />}
          <MetricChip size="lg" icon="check" label="Tests" value={String(verdict.totalPassed)} unit={`/ ${verdict.totalTests}`} />
        </div>
      )}

      {ok && kind === 'submit' && verdict.percentile != null && (
        <div className={s.beats} data-testid="percentile">
          <div className={s.beatsHead}>
            <span className={s.beatsLabel}>
              <Icon name="trend" size={13} /> Beats <strong className="mono">{formatPercent(verdict.percentile)}%</strong> of {languageLabel(language)} solutions
            </span>
            <span className={s.beatsNote}>by CPU time, latest accepted submission per person</span>
          </div>
          <Progress value={verdict.percentile} tone="ok" height={5} />
        </div>
      )}

      {tip && <p className={s.advice}>{tip}</p>}

      {verdict.error && (verdict.status === 'CE' || verdict.status === 'RE' || verdict.status === 'XX' || verdict.status === 'MLE') && (
        <JudgeOutput
          text={verdict.error}
          tone={verdict.status === 'CE' ? 'info' : verdict.status === 'XX' ? 'muted' : 'err'}
          onLine={onLine}
          label={verdict.status === 'CE' ? 'Compiler output' : 'Error output'}
        />
      )}

      {earned && (
        <div className={s.rewards} data-testid="rewards">
          {verdict.tokensAwarded?.map((t) => (
            <Pill key={t.topic} tone="warn" size="md" icon="coin">
              +{t.amount} {t.title}
            </Pill>
          ))}
          {verdict.badgesAwarded?.map((b) => (
            <Pill key={b.slug} tone="accent" size="md" icon="award" title={b.description}>
              {b.name}
            </Pill>
          ))}
        </div>
      )}

      {ranTests && <TestStrip tests={tests} total={verdict.totalTests} onSelect={onSelectTest} />}

      {(actions || (ok && kind === 'run' && onSubmit)) && (
        <div className={s.heroActions}>
          {ok && kind === 'run' && onSubmit && (
            <Button variant="primary" size="sm" icon="send" onClick={onSubmit}>
              Submit
            </Button>
          )}
          {actions}
        </div>
      )}
    </section>
  );
}
