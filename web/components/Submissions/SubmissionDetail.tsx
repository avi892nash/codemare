import { EmptyState } from '@/components/states/EmptyState';
import { BigMetric } from '@/components/ui/BigMetric';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { MetricChip } from '@/components/ui/MetricChip';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { LANGUAGE_LABEL } from '@/components/ui/highlight';
import { fmtMem } from '@/components/ui/formatters';
import type { SubmissionTestView, SubmissionView } from '@/lib/server/submissionHistory';
import { SOLUTION_FILE, fmtAbsolute, fmtMicros, fmtRelative, fmtValue } from './format';
import { subjectTitle } from './SubmissionRows';
import { SubmissionStatus } from './SubmissionStatus';
import s from './Submissions.module.css';

type Tone = 'ok' | 'err' | 'warn' | undefined;

function toneOf(status: SubmissionView['status']): Tone {
  if (status === 'OK') return 'ok';
  if (status === 'WA' || status === 'RE') return 'err';
  if (status === 'TLE' || status === 'MLE') return 'warn';
  return undefined;
}

/** Why there is no runtime to show. */
function noRuntimeNote(status: SubmissionView['status']): string {
  switch (status) {
    case 'CE':
      return 'The code did not compile, so no tests ran. The compiler output is below.';
    case 'XX':
      return 'The judge hit an internal error before it could time this run. It is not your code: run it again.';
    case 'queued':
    case 'running':
      return 'This submission has not finished judging yet.';
    default:
      return 'No timing was recorded for this submission.';
  }
}

/**
 * 05 · Submission detail: verdict hero (runtime in µs, memory, percentile),
 * the code, and the per-test breakdown. Visible tests show input / expected /
 * output (and explain_on_fail when they failed); hidden tests only pass/fail.
 * Server component.
 */
export function SubmissionDetail({ view, now }: { view: SubmissionView; now: Date }) {
  const title = subjectTitle(view.subject);
  const lang = LANGUAGE_LABEL[view.language];
  const runtime = fmtMicros(view.runtimeUs);
  const memory = fmtMem(view.memoryKb);
  const tone = toneOf(view.status);
  // A compile error (or a submission still judging) has nothing to measure.
  const hasMetrics = view.runtimeUs != null || view.memoryKb != null || view.totalTests > 0 || view.compileMs != null;
  const beats = view.status === 'OK' && view.percentile != null ? Math.round(view.percentile * 10) / 10 : null;
  const lines = view.code.split('\n').length;
  const perTest = fmtMicros(
    view.runtimeUs != null && view.totalTests > 0 ? Math.round(view.runtimeUs / view.totalTests) : null
  );

  return (
    <main className={`scroll ${s.main}`}>
      <div className={s.page}>
        <Breadcrumb
          className={s.crumbs}
          items={[{ label: 'Submissions', href: '/submissions', icon: 'history' }, { label: title }]}
        />

        <header className={s.detailHead}>
          <div style={{ minWidth: 0 }}>
            <p className={s.eyebrow}>
              Submission ·{' '}
              <time dateTime={view.createdAt.toISOString()} title={fmtAbsolute(view.createdAt)}>
                {fmtRelative(view.createdAt, now)}
              </time>
            </p>
            <h1 className={s.title}>
              {title}
              {view.subject.type === 'build' && <span className={s.subtle}> · {view.subject.stepTitle}</span>}
            </h1>
            <div className={s.headMeta}>
              <SubmissionStatus status={view.status} size="md" long />
              {view.totalTests > 0 && (
                <span>
                  <span className="mono" style={{ color: 'var(--fg-0)' }}>
                    {view.totalPassed} / {view.totalTests}
                  </span>{' '}
                  tests passed
                </span>
              )}
              <span className={s.dot} aria-hidden="true">·</span>
              <span className={s.metaLang}>
                <LangMark lang={view.language} size={13} />
                {lang}
              </span>
              <Pill tone="muted" size="xs" className="mono">
                {view.kind}
              </Pill>
              {view.subject.type === 'question' && <DifficultyPill level={view.subject.difficulty} size="xs" />}
              {!view.own && (
                <Pill tone="info" size="xs" icon="user">
                  @{view.owner.handle}
                </Pill>
              )}
            </div>
          </div>
          <div className={s.headActions}>
            {view.subject.type === 'question' && (
              <ButtonLink href={`/problems/${view.subject.slug}`} variant="primary" icon="code">
                Open problem
              </ButtonLink>
            )}
            <ButtonLink href="/submissions" variant="default" icon="history">
              All submissions
            </ButtonLink>
          </div>
        </header>

        <section className={s.hero} data-tone={tone} data-single={!hasMetrics || undefined} aria-label="Result">
          {view.runtimeUs != null ? (
            <BigMetric
              label="Runtime · CPU time, all tests"
              primary={{ value: runtime[0], unit: runtime[1] }}
              tone={view.status === 'OK' ? 'ok' : 'default'}
              extra={
                beats != null ? (
                  <div style={{ maxWidth: 320 }}>
                    <ProgressBar label="Beats" value={beats} max={100} showValue valueText={`${beats}%`} height={5} />
                    <p className={s.sub} style={{ fontSize: 12 }}>
                      of accepted {lang} submissions on this problem
                    </p>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <p className={s.heroNote}>{noRuntimeNote(view.status)}</p>
          )}
          {hasMetrics && (
            <div className={s.heroSide}>
              <MetricChip size="lg" icon="memory" label="Peak memory" value={memory[0]} unit={memory[1] || undefined} />
              <MetricChip
                size="lg"
                icon="check-circle"
                label="Tests passed"
                value={view.totalTests > 0 ? `${view.totalPassed}/${view.totalTests}` : '—'}
              />
              <MetricChip
                size="lg"
                icon="cpu"
                label="Compile"
                value={view.compileMs != null ? view.compileMs : '—'}
                unit={view.compileMs != null ? 'ms' : undefined}
              />
              <MetricChip size="lg" icon="clock" label="Avg per test" value={perTest[0]} unit={perTest[1] || undefined} />
            </div>
          )}
        </section>

        {view.error && (
          <section className={s.section} aria-labelledby="sub-error">
            <h2 id="sub-error" className={s.sectionHead}>
              {view.status === 'CE' ? 'Compiler output' : 'Error output'}
            </h2>
            <CodeBlock
              code={view.error}
              highlight={false}
              showGutter={false}
              filename={view.status === 'CE' ? 'compiler' : 'stderr'}
              maxHeight={320}
            />
          </section>
        )}

        <section className={s.section} aria-labelledby="sub-code">
          <h2 id="sub-code" className={s.sectionHead}>
            Code <span>{lines} {lines === 1 ? 'line' : 'lines'}</span>
          </h2>
          <CodeBlock code={view.code} language={view.language} filename={SOLUTION_FILE[view.language]} copy maxHeight={560} />
        </section>

        <section className={s.section} aria-labelledby="sub-tests">
          <h2 id="sub-tests" className={s.sectionHead}>
            Tests{' '}
            {view.tests.length > 0 && (
              <span>
                {view.tests.filter((t) => t.passed).length} / {view.tests.length} passed
              </span>
            )}
          </h2>
          {view.tests.length === 0 ? (
            <div className={s.empty}>
              <EmptyState
                size="sm"
                icon="list"
                headingLevel={3}
                title="No test results"
                description={
                  view.status === 'CE'
                    ? 'Nothing ran because the code did not compile.'
                    : 'This submission has no per-test results.'
                }
              />
            </div>
          ) : (
            <ol className={s.tests}>
              {view.tests.map((t) => (
                <li key={t.idx}>{t.hidden ? <HiddenTest test={t} /> : <VisibleTest test={t} />}</li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function TestMark({ passed }: { passed: boolean }) {
  return (
    <span className={s.testIcon} data-passed={passed} style={{ display: 'inline-flex' }}>
      <Icon name={passed ? 'check-circle' : 'x'} size={15} />
      <span className="sr-only">{passed ? 'Passed' : 'Failed'}</span>
    </span>
  );
}

function HiddenTest({ test }: { test: SubmissionTestView }) {
  return (
    <div className={s.testHead}>
      <TestMark passed={test.passed} />
      <span className={s.testName}>Test {test.idx + 1}</span>
      <Pill tone="muted" size="xs" icon="eye-off">
        Hidden
      </Pill>
      <span className={s.testSpacer} />
      <span className={s.testStats} aria-hidden="true">
        {test.passed ? 'passed' : 'failed'}
      </span>
      <span style={{ width: 14 }} aria-hidden="true" />
    </div>
  );
}

function VisibleTest({ test }: { test: SubmissionTestView }) {
  const rt = fmtMicros(test.runtimeUs);
  const mem = fmtMem(test.memoryKb);
  return (
    <details open={!test.passed}>
      <summary className={s.testHead}>
        <TestMark passed={test.passed} />
        <span className={s.testName}>Test {test.idx + 1}</span>
        <span className={s.testSpacer} />
        <span className={s.testStats}>
          {rt[0]} {rt[1]} · {mem[0]} {mem[1]}
        </span>
        <Icon name="chev-right" size={14} className={s.chev} />
      </summary>
      <div className={s.testBody}>
        <dl className={s.io}>
          <dt>Input</dt>
          <dd>
            {(test.args ?? []).map((a, i) => (
              <code key={i} className={s.value}>
                {a.name && <span className={s.argName}>{a.name} = </span>}
                {fmtValue(a.value)}
              </code>
            ))}
          </dd>
          <dt>Expected</dt>
          <dd>
            <code className={s.value}>{fmtValue(test.expected)}</code>
          </dd>
          <dt>Output</dt>
          <dd>
            <code className={s.value} data-tone={test.passed ? 'ok' : 'err'}>
              {test.actual === undefined || (test.actual === null && test.error) ? '—' : fmtValue(test.actual)}
            </code>
          </dd>
          {test.error && (
            <>
              <dt>Error</dt>
              <dd>
                <code className={s.value} data-tone="err">
                  {test.error}
                </code>
              </dd>
            </>
          )}
        </dl>
        {test.explainOnFail && (
          <Callout kind="pitfall" title="What this test checks">
            {test.explainOnFail}
          </Callout>
        )}
      </div>
    </details>
  );
}
