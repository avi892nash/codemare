import { Fragment, type ReactNode } from 'react';
import { Pill } from '@/components/ui/Pill';
import type { Example } from '@/lib/types';
import { Markdown } from './Markdown';
import { MoreDisclosure } from './MoreDisclosure';
import s from './Problem.module.css';

interface ProblemStatementProps {
  statementMd: string;
  examples: Example[];
  constraints: string[];
  topics?: { slug: string; title: string; icon: string }[];
  tags?: string[];
  companies?: string[];
}

/** "2 <= n <= 10^4" → "2 ≤ n ≤ 10⁴" (with a real superscript). */
function prettyConstraint(text: string): ReactNode {
  const symbols = text.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠');
  const parts = symbols.split(/(\d+\^(?:-?\d+|\{[^}]+\}))/g);
  return parts.map((part, i) => {
    const m = /^(\d+)\^\{?(-?[^}]+)\}?$/.exec(part);
    return m ? (
      <Fragment key={i}>
        {m[1]}
        <sup>{m[2]}</sup>
      </Fragment>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    );
  });
}

function ExampleBlock({ example, n }: { example: Example; n: number }) {
  return (
    <section className={s.example} aria-label={`Example ${n}`}>
      <h2 className={s.sectionTitle}>Example {n}</h2>
      <div className={s.exampleBody}>
        <div className={s.exampleRow}>
          <span className={s.exampleKey}>Input</span>
          <code className={`${s.exampleValue} mono`}>{example.input}</code>
        </div>
        <div className={s.exampleRow}>
          <span className={s.exampleKey}>Output</span>
          <code className={`${s.exampleValue} mono`}>{example.output}</code>
        </div>
        {example.explanation && (
          <div className={s.exampleRow}>
            <span className={s.exampleKey}>Why</span>
            <span className={s.exampleText}>{example.explanation}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A question's statement: the sanitized markdown statement and its first
 * example, then — behind one "More" toggle on a phone, simply there on a
 * desktop — the other examples, constraints, topic and tag chips and the
 * companies. A server component — only the toggle ships JavaScript.
 */
export function ProblemStatement({ statementMd, examples, constraints, topics = [], tags = [], companies = [] }: ProblemStatementProps) {
  const [first, ...more] = examples;
  const extraTags = tags.filter((tag) => !topics.some((t) => t.title.toLowerCase() === tag.toLowerCase()));
  const hasChips = topics.length > 0 || extraTags.length > 0;
  const hint = [
    more.length > 0 ? `${more.length} more example${more.length === 1 ? '' : 's'}` : null,
    constraints.length > 0 ? 'constraints' : null,
    hasChips ? 'tags' : null,
    companies.length > 0 ? 'companies' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <article className={s.statement} data-testid="problem-statement">
      <Markdown>{statementMd}</Markdown>

      {first && <ExampleBlock example={first} n={1} />}

      {hint && (
        <MoreDisclosure hint={hint}>
          {more.map((ex, i) => (
            <ExampleBlock key={i} example={ex} n={i + 2} />
          ))}

          {constraints.length > 0 && (
            <section aria-label="Constraints">
              <h2 className={s.sectionTitle}>Constraints</h2>
              <ul className={s.constraints}>
                {constraints.map((c) => (
                  <li key={c}>
                    <span className="mono">{prettyConstraint(c)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasChips && (
            <div className={s.chips}>
              {topics.map((t) => (
                <Pill key={t.slug} tone="accent" size="xs" icon={t.icon} style={{ fontSize: 'var(--fs-xs)' }}>
                  {t.title}
                </Pill>
              ))}
              {extraTags.map((tag) => (
                <Pill key={tag} tone="muted" size="xs" style={{ fontSize: 'var(--fs-xs)' }}>
                  {tag}
                </Pill>
              ))}
            </div>
          )}

          {companies.length > 0 && (
            <p className={s.companies}>
              Asked at <span>{companies.join(' · ')}</span>
            </p>
          )}
        </MoreDisclosure>
      )}
    </article>
  );
}
