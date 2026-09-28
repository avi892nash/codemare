import type { Element, ElementContent } from 'hast';
import type { ComponentPropsWithoutRef, CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@/components/ui/CodeBlock';
import s from './markdown.module.css';

/**
 * GitHub-flavored markdown → sanitized React (react-markdown + remark-gfm +
 * rehype-sanitize with its GitHub schema: no raw HTML, no scripts, no
 * javascript: URLs). No 'use client': library pages render it on the server
 * (zero client JS), the authoring preview renders it in the browser.
 *
 * Fenced code becomes the UI kit's <CodeBlock>; headings shift down by
 * `headingOffset` so content headings nest under the page's own h1/h2.
 */
export interface MarkdownProps {
  children: string;
  /** `#` renders as h(1 + offset). Default 2: content sits under an h2 section title. */
  headingOffset?: number;
  /** Open every link in a new tab (the editor preview must never navigate away). */
  newTabLinks?: boolean;
  /** Smaller type for dense panels (hints, previews). */
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

function textOf(node: ElementContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function isExternal(href: string | undefined): boolean {
  return !!href && /^(https?:)?\/\//i.test(href);
}

export function Markdown({ children, headingOffset = 2, newTabLinks = false, size = 'md', className, style }: MarkdownProps) {
  const heading = (level: number) => {
    const Tag = `h${Math.min(6, level + headingOffset)}` as 'h3';
    const H = ({ children: c, node: _node, ...rest }: ComponentPropsWithoutRef<'h3'> & { node?: Element }) => (
      <Tag {...rest} className={s[`h${level}`]}>
        {c}
      </Tag>
    );
    return H;
  };

  const components: Components = {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    a: ({ href, children: c, node: _node, ...rest }) => {
      const blank = newTabLinks || isExternal(href);
      return (
        <a {...rest} href={href} className={`${s.link} focus-ring`} {...(blank ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {c}
        </a>
      );
    },
    pre: ({ node }) => {
      const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      const classes = (code?.properties?.className as string[] | undefined) ?? [];
      const lang = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length);
      const text = (code ? textOf(code) : '').replace(/\n$/, '');
      return <CodeBlock code={text} language={lang} showGutter={text.split('\n').length > 3} className={s.codeBlock} />;
    },
    code: ({ children: c, node: _node, className: _cls, ...rest }) => (
      <code {...rest} className="cd-inline">
        {c}
      </code>
    ),
    table: ({ children: c, node: _node, ...rest }) => (
      <div className={`${s.tableWrap} scroll`} tabIndex={0} role="region" aria-label="Table">
        <table {...rest}>{c}</table>
      </div>
    ),
    img: ({ node: _node, alt, ...rest }) => (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary author-supplied URLs; next/image needs known hosts
      <img {...rest} alt={alt ?? ''} className={s.img} loading="lazy" />
    ),
  };

  return (
    <div className={[s.md, size === 'sm' && s.sm, className].filter(Boolean).join(' ')} style={style}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
