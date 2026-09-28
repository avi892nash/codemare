import { Fragment, type ReactNode } from 'react';
import { Pill } from '@/components/ui/Pill';
import type { Example } from '@/lib/types';
import { Markdown } from './Markdown';
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

/**
 * A question's statement: topic and tag chips, the sanitized markdown
 * statement, worked examples and constraints. A server component — none of
 * it ships JavaScript.
 */
export function ProblemStatement({ statementMd, examples, constraints, topics = [], tags = [], companies = [] }: ProblemStatementProps) {
  return (
    <article className={s.statement} data-testid="problem-statement">
      {(topics.length > 0 || tags.length > 0) && (
        <div className={s.chips}>
          {topics.map((t) => (
            <Pill key={t.slug} tone="accent" size="xs" icon={t.icon}>
              {t.title}
            </Pill>
          ))}
          {tags
            .filter((tag) => !topics.some((t) => t.title.toLowerCase() === tag.toLowerCase()))
            .map((tag) => (
              <Pill key={tag} tone="muted" size="xs">
                {tag}
              </Pill>
            ))}
        </div>
      )}

      <Markdown>{statementMd}</Markdown>

      {examples.map((ex, i) => (
        <section key={i} className={s.example} aria-label={`Example ${i + 1}`}>
          <h2 className={s.sectionTitle}>Example {i + 1}</h2>
          <div className={s.exampleBody}>
            <div className={s.exampleRow}>
              <span className={s.exampleKey}>Input</span>
              <code className={`${s.exampleValue} mono`}>{ex.input}</code>
            </div>
            <div className={s.exampleRow}>
              <span className={s.exampleKey}>Output</span>
              <code className={`${s.exampleValue} mono`}>{ex.output}</code>
            </div>
            {ex.explanation && (
              <div className={s.exampleRow}>
                <span className={s.exampleKey}>Why</span>
                <span className={s.exampleText}>{ex.explanation}</span>
              </div>
            )}
          </div>
        </section>
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

      {companies.length > 0 && (
        <p className={s.companies}>
          Asked at <span>{companies.join(' · ')}</span>
        </p>
      )}
    </article>
  );
}
