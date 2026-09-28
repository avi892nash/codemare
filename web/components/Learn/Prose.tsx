import Link from 'next/link';
import Markdown, { type Components } from 'react-markdown';
import { Icon } from '@/components/ui/Icon';
import { MARKDOWN_OPTIONS, isExternalHref } from '@/lib/lesson-markdown/config';
import s from './learn.module.css';

/*
 * One markdown chunk of a lesson (or a checkpoint prompt / explanation),
 * rendered on the server with the sanitizing options from
 * lib/lesson-markdown/config.ts. Fenced code never reaches here (the
 * pre-pass turns it into CodeBlock / RunnableCodeBlock).
 */

const components: Components = {
  // The page title is the only h1.
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  a: ({ node: _node, href, children, ...props }) => {
    if (!href) return <span>{children}</span>;
    if (isExternalHref(href)) {
      return (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer nofollow">
          {children}
          <Icon name="external" size={11} className={s.extIcon} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }
    return (
      <Link {...props} href={href}>
        {children}
      </Link>
    );
  },
  table: ({ node: _node, ...props }) => (
    <div className={`${s.tableWrap} scroll`} tabIndex={0} role="region" aria-label="Table">
      <table {...props} />
    </div>
  ),
  // eslint-disable-next-line @next/next/no-img-element
  img: ({ node: _node, src, alt }) => <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" />,
};

const inlineComponents: Components = {
  ...components,
  p: ({ node: _node, ...props }) => <span {...props} />,
};

/**
 * `compact` inherits the surrounding font size (callouts, explanations).
 * `inline` renders phrasing content only (a <span>, paragraphs unwrapped)
 * for places like quiz choice labels.
 */
export function Prose({ md, compact = false, inline = false }: { md: string; compact?: boolean; inline?: boolean }) {
  const Wrap = inline ? 'span' : 'div';
  return (
    <Wrap className={[s.prose, (compact || inline) && s.proseCompact].filter(Boolean).join(' ')}>
      <Markdown {...MARKDOWN_OPTIONS} components={inline ? inlineComponents : components}>
        {md}
      </Markdown>
    </Wrap>
  );
}
