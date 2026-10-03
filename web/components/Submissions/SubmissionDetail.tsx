import { EmptyState } from '@/components/states/EmptyState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { PageHeader } from '@/components/ui/PageHeader';
import { LANGUAGE_LABEL } from '@/components/ui/highlight';
import { formatPercent } from '@/lib/client/format';
import { VERDICT_LOOK } from '@/lib/client/resultCopy';
import type { SubmissionTestView, SubmissionView } from '@/lib/server/submissionHistory';
import { SOLUTION_FILE, fmtAbsolute, fmtKb, fmtMicros, fmtRelative, fmtValue, submissionHeadline } from './format';
import { KIND_LABEL, subjectTitle } from './SubmissionRows';
import s from './Submissions.module.css';

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
 * 05 · Submission detail, in the result card's words: the problem as the title, the verdict as the headline
 * ("Accepted — all 10 tests passed"), then one quiet row of runtime, memory and — only when 30 learners' solutions
 * back it — how it compares; the code, and the per-test breakdown. Visible tests show input / expected / output (and
 * the author's note when they failed); hidden tests only pass/fail. Server component.
 */
export function SubmissionDetail({ view, now }: { view: SubmissionView; now: Date }) {
  const title = subjectTitle(view.subject);
  const lang = LANGUAGE_LABEL[view.language];
  const runtime = fmtMicros(view.runtimeUs);
  const memory = fmtKb(view.memoryKb);
  const pending = view.status === 'queued' || view.status === 'running';
  const look = pending ? { tone: 'muted' as const, icon: 'clock' as const } : VERDICT_LOOK[view.status as keyof typeof VERDICT_LOOK];
  const headline = submissionHeadline(view);
  // A compile error (or a submission still judging) has nothing to measure.
  const hasRuntime = view.runtimeUs != null;
  const perTest = fmtMicros(view.runtimeUs != null && view.totalTests > 0 ? Math.round(view.runtimeUs / view.totalTests) : null);
  const hasFacts = hasRuntime || view.memoryKb != null || view.compileMs != null;
  const faster = view.status === 'OK' && view.percentile != null ? formatPercent(view.percentile) : null;
  const lines = view.code.split('\n').length;

  return (
    <main className={`scroll ${s.main}`}>
      <div className={s.page}>
        <Breadcrumb className={s.crumbs} items={[{ label: 'Submissions', href: '/submissions', icon: 'history' }, { label: title }]} />

        <PageHeader
          title={title}
          subtitle={
            <span className={s.metaRow}>
              <span>
                Submitted{' '}
                <time className={s.metaTime} dateTime={view.createdAt.toISOString()} title={fmtAbsolute(view.createdAt)}>
                  {fmtRelative(view.createdAt, now)}
                </time>
                {!view.own && (
                  <>
                    {' by '}
                    <span>@{view.owner.handle}</span>
                  </>
                )}
              </span>
              <span className={s.sep} aria-hidden="true">
                ·
              </span>
              <span className={s.metaLang}>
                <LangMark lang={view.language} />
                {lang}
              </span>
              <span className={s.sep} aria-hidden="true">
                ·
              </span>
              <span>{KIND_LABEL[view.kind]}</span>
              {view.subject.type === 'question' && (
                <>
                  <span className={s.sep} aria-hidden="true">
                    ·
                  </span>
                  <DifficultyText level={view.subject.difficulty} />
                </>
              )}
            </span>
          }
          actions={
            view.subject.type === 'question' && (
              <ButtonLink href={`/problems/${view.subject.slug}`} variant="primary" icon="code" className={s.openBtn}>
                Open problem
              </ButtonLink>
            )
          }
        />

        <section className={s.result} data-tone={look.tone} aria-label="Result" data-testid="submission-verdict">
          <div className={s.resultTop}>
            <span className={s.resultIcon} aria-hidden="true">
              <Icon name={look.icon} size={20} strokeWidth={2} />
            </span>
            <div className={s.resultHeading}>
              <h2 className={s.resultTitle} data-testid="submission-headline">
                <span className={s.word}>{headline.word}</span>
                {headline.rest && ` — ${headline.rest}`}
              </h2>
              {!hasFacts && <p className={s.resultNote}>{noRuntimeNote(view.status)}</p>}
            </div>
            {!pending && (
              <span className={`${s.resultCode} mono`} aria-hidden="true">
                {view.status}
              </span>
            )}
          </div>

          {hasFacts && (
            <div className={s.facts} data-testid="submission-metrics">
              <dl className={s.factList}>
                {hasRuntime && (
                  <div className={s.fact}>
                    <dt>Runtime</dt>{' '}
                    <dd className="mono">
                      {runtime[0]} <abbr title={runtime[1] === 'µs' ? 'microseconds, a millionth of a second' : 'CPU time, all tests'}>{runtime[1]}</abbr>
                    </dd>
                  </div>
                )}
                {view.memoryKb != null && (
                  <div className={s.fact}>
                    <dt>Memory</dt>{' '}
                    <dd className="mono">
                      {memory[0]} {memory[1]}
                    </dd>
                  </div>
                )}
                {view.compileMs != null && (
                  <div className={s.fact}>
                    <dt>Compile time</dt>{' '}
                    <dd className="mono">{view.compileMs} ms</dd>
                  </div>
                )}
                {hasRuntime && perTest[0] !== '—' && (
                  <div className={s.fact}>
                    <dt>Per test</dt>{' '}
                    <dd className="mono">
                      {perTest[0]} {perTest[1]}
                    </dd>
                  </div>
                )}
                {faster != null && (
                  <div
                    className={s.fact}
                    data-testid="percentile"
                    title={`By CPU time: each learner’s latest accepted ${lang} solution of this problem.`}
                  >
                    <dt className="sr-only">Speed</dt>{' '}
                    <dd className={s.speed}>
                      <Icon name="trend" size={14} />
                      <span>
                        Faster than <strong className="mono">{faster}%</strong> of other learners
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
              {hasRuntime && runtime[1] === 'µs' && <p className={s.unitNote}>µs = microseconds. Runtime is CPU time over all tests.</p>}
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
            Code{' '}
            <span>
              {lines} {lines === 1 ? 'line' : 'lines'}
            </span>
          </h2>
          <CodeBlock code={view.code} language={view.language} filename={SOLUTION_FILE[view.language]} copy maxHeight={560} />
        </section>

        <section className={s.section} aria-labelledby="sub-tests">
          <h2 id="sub-tests" className={s.sectionHead}>
            Tests{' '}
            {view.tests.length > 0 && (
              <span>
                {view.tests.filter((t) => t.passed).length} of {view.tests.length} passed
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
    <span className={s.testIcon} data-passed={passed}>
      <Icon name={passed ? 'check-circle' : 'x'} size={16} />
      <span className="sr-only">{passed ? 'Passed' : 'Failed'}</span>
    </span>
  );
}

function HiddenTest({ test }: { test: SubmissionTestView }) {
  return (
    <div className={s.testHead}>
      <TestMark passed={test.passed} />
      <span className={s.testName}>Test {test.idx + 1}</span>
      <span className={s.hiddenTag}>
        <Icon name="eye-off" size={12} />
        Hidden
      </span>
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
  const mem = fmtKb(test.memoryKb);
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
          <p className={s.explain} role="note" aria-label="What this test checks">
            <strong>What this test checks.</strong> {test.explainOnFail}
          </p>
        )}
      </div>
    </details>
  );
}
