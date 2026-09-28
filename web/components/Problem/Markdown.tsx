import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@/components/ui/CodeBlock';
import s from './Markdown.module.css';

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

/**
 * GitHub-flavored markdown, sanitized (rehype-sanitize's GitHub schema: no
 * raw HTML, scripts, event handlers or javascript: URLs). Fenced code goes
 * through the UI kit's CodeBlock. No hooks — renders on the server for
 * statements and editorials, and in the browser for revealed hints.
 */
export function Markdown({ children, className, compact = false }: { children: string; className?: string; compact?: boolean }) {
  return (
    <div className={[s.md, compact && s.compact, className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre({ children: pre }) {
            const child = Array.isArray(pre) ? pre[0] : pre;
            if (isValidElement(child)) {
              const props = (child as ReactElement<{ className?: string; children?: ReactNode }>).props;
              const lang = /language-([\w+#-]+)/.exec(props.className ?? '')?.[1];
              return (
                <CodeBlock
                  code={textOf(props.children).replace(/\n$/, '')}
                  language={lang}
                  copy
                  showGutter={false}
                  className={s.block}
                />
              );
            }
            return <pre className="codeblock">{pre}</pre>;
          },
          code({ children: code }) {
            return <code className="cd-inline">{code}</code>;
          },
          a({ href, children: label }) {
            const external = !!href && /^https?:\/\//.test(href);
            return (
              <a href={href} className={`${s.link} focus-ring`} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {label}
              </a>
            );
          },
          table({ children: rows }) {
            return (
              <div className={s.tableWrap}>
                <table>{rows}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
