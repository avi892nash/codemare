import Link from 'next/link';
import { Markdown } from '@/components/Problem/Markdown';
import { ButtonLink } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { Pill } from '@/components/ui/Pill';
import { timeAgo } from '@/lib/client/format';
import { LANGUAGE_META, languageLabel } from '@/lib/client/languages';
import { signatureLine, type LibraryComponentView } from '@/lib/server/loopViews';
import { LanguageTabs } from './LanguageTabs';
import s from './library.module.css';

const HISTORY_SHOWN = 8;

function Node({ node }: { node: { slug: string; title: string; built: boolean } }) {
  const inner = (
    <>
      <Icon name={node.built ? 'check-circle' : 'circle'} size={11} />
      <span>
        {node.title}
        <span className="sr-only">{node.built ? ' (built)' : ' (not built yet)'}</span>
      </span>
    </>
  );
  return node.built ? (
    <a href={`#component-${node.slug}`} className={`${s.node} focus-ring`} data-built>
      {inner}
    </a>
  ) : (
    <span className={s.node}>{inner}</span>
  );
}

/** What the component calls ↓ the component ↓ what calls it — the prelude flows downward. */
function DepGraph({ c }: { c: LibraryComponentView }) {
  return (
    <figure className={s.graph} aria-label={`${c.title}: what it calls and what calls it`} data-testid="dep-graph">
      <span className={s.graphLabel}>Calls</span>
      <div className={s.graphNodes}>
        {c.dependsOn.length ? c.dependsOn.map((d) => <Node key={d.slug} node={d} />) : <span className={s.none}>nothing — it stands alone</span>}
      </div>
      <span className={s.graphArrow} aria-hidden="true">
        <Icon name="arrow-down" size={12} />
      </span>
      <span className={s.graphLabel}>
        <span className="sr-only">This component</span>
      </span>
      <div className={s.graphNodes}>
        <span className={s.node} data-self>
          <Icon name="puzzle" size={11} />
          <span>{c.title}</span>
        </span>
      </div>
      <span className={s.graphArrow} aria-hidden="true">
        <Icon name="arrow-down" size={12} />
      </span>
      <span className={s.graphLabel}>Called by</span>
      <div className={s.graphNodes}>
        {c.usedBy.length ? c.usedBy.map((d) => <Node key={d.slug} node={d} />) : <span className={s.none}>nothing yet</span>}
      </div>
    </figure>
  );
}

function History({ c, now }: { c: LibraryComponentView; now: number }) {
  const shown = c.history.slice(0, HISTORY_SHOWN);
  return (
    <details className={s.history}>
      <summary className="focus-ring">
        <Icon name="chev-right" size={11} /> Version history ({c.history.length})
      </summary>
      <ol className={s.versions}>
        {shown.map((v) => (
          <li key={v.versionId} className={s.version}>
            <span className={s.versionNum}>v{v.number}</span>
            <span className={s.versionMain}>
              <LangMark lang={v.language} size={12} />
              <span>{languageLabel(v.language)}</span>
              <Pill tone={v.passed ? 'ok' : 'err'} size="xs">
                {v.passed ? 'Passed' : 'Failed'}
              </Pill>
            </span>
            <span className={s.versionWhen}>
              <Link href={`/submissions/${encodeURIComponent(v.submissionId)}`} className="focus-ring" aria-label={`Submission for ${languageLabel(v.language)} v${v.number}`}>
                {timeAgo(v.createdAt, now)}
              </Link>
            </span>
          </li>
        ))}
      </ol>
      {c.history.length > shown.length && <p className={s.more}>and {c.history.length - shown.length} older</p>}
    </details>
  );
}

/**
 * One built component: its latest passing code per language (the version
 * later builds call), how it connects to the others, its version history,
 * and a way back to the queue to rebuild it.
 */
export function ComponentCard({ c, now }: { c: LibraryComponentView; now: number }) {
  const titleId = `component-${c.slug}-title`;
  return (
    <article className={s.comp} id={`component-${c.slug}`} aria-labelledby={titleId} data-testid={`component-${c.slug}`}>
      <header className={s.head}>
        <span className={s.icon} aria-hidden="true">
          <Icon name="puzzle" size={17} />
        </span>
        <div className={s.headText}>
          <h3 className={s.title} id={titleId}>
            {c.title}
          </h3>
          <div className={s.meta}>
            <Link href={`/map#topic-${c.topic.slug}`} className={`${s.topicLink} focus-ring`}>
              <Icon name={c.topic.icon} size={12} /> {c.topic.title}
            </Link>
            <span className={s.signature}>{signatureLine(c.functionName, c.signature)}</span>
          </div>
        </div>
        <div className={s.headActions}>
          {c.nextStepId && c.nextStepId !== c.rebuildStepId && (
            <ButtonLink href={`/queue?step=${encodeURIComponent(c.nextStepId)}`} size="sm" variant="ghost" icon="layers">
              Finish in queue
            </ButtonLink>
          )}
          {c.rebuildStepId && (
            <ButtonLink href={`/queue?step=${encodeURIComponent(c.rebuildStepId)}`} size="sm" icon="refresh" aria-label={`Rebuild ${c.title} in the queue`}>
              Rebuild
            </ButtonLink>
          )}
        </div>
      </header>
      {c.summaryMd && (
        <div className={s.summary}>
          <Markdown compact>{c.summaryMd}</Markdown>
        </div>
      )}
      <div className={s.body}>
        <LanguageTabs
          label={`${c.title}: latest passing code by language`}
          panels={c.latest.map((v) => ({
            value: v.language,
            label: languageLabel(v.language),
            note: (
              <span className={s.versionNote}>
                v{v.number} · passed {timeAgo(v.createdAt, now)}
                {v.submissionId && (
                  <>
                    {' '}
                    ·{' '}
                    <Link href={`/submissions/${encodeURIComponent(v.submissionId)}`} className="focus-ring">
                      submission
                    </Link>
                  </>
                )}
              </span>
            ),
            code: (
              <CodeBlock
                code={v.code}
                language={v.language}
                filename={`${c.functionName}.${LANGUAGE_META[v.language].ext}`}
                copy
                maxHeight={360}
              />
            ),
          }))}
        />
        <div className={s.side}>
          <div>
            <p className={s.label}>Dependencies</p>
            <DepGraph c={c} />
          </div>
          <History c={c} now={now} />
        </div>
      </div>
    </article>
  );
}
