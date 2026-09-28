/**
 * The markdown half of lesson rendering: react-markdown options shared by
 * the renderer (components/Learn/Prose.tsx) and the tests, so the tests
 * exercise exactly what ships.
 *
 * Defense in depth against hostile lesson content (content is edited in a
 * CMS, so treat it as untrusted):
 *   1. react-markdown never renders raw HTML (no rehype-raw): `<script>`,
 *      `<iframe>`, `onerror=` … are dropped before they become elements.
 *   2. rehype-sanitize with a GitHub-style allow-list (tags, attributes,
 *      protocols; ids clobber-prefixed).
 *   3. `safeUrl` rewrites every href/src: only relative URLs and
 *      http(s)/mailto survive; `javascript:`, `data:`, `vbscript:` … become ''.
 */
import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

type Schema = NonNullable<typeof defaultSchema>;

const SAFE_PROTOCOL = /^(https?:|mailto:)/i;

/**
 * Relative URLs (`/problems/two-sum`, `#section`, `./x`) and http(s)/mailto
 * pass; everything else — including protocol-relative `//evil.test` and
 * obfuscated schemes like `java\tscript:` — becomes the empty string.
 */
export function safeUrl(url: string): string {
  // Browsers ignore ASCII whitespace/control characters inside schemes.
  // eslint-disable-next-line no-control-regex
  const compact = String(url ?? '').replace(/[\u0000- \u007f-\u009f]/g, '');
  if (compact === '') return '';
  if (compact.startsWith('//') || compact.startsWith('\\\\') || compact.startsWith('/\\')) return '';
  if (/^[/#?]/.test(compact) || compact.startsWith('./') || compact.startsWith('../')) return url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (!scheme) return url.trim(); // a bare relative path like `two-sum`
  return SAFE_PROTOCOL.test(compact) ? url.trim() : '';
}

/** GitHub's schema, narrowed: fewer protocols, no inline `style`, no forms. */
export const SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
    cite: ['http', 'https'],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => !['input', 'form', 'button', 'select', 'textarea'].includes(t)),
};

/** The react-markdown options every lesson markdown chunk is rendered with. */
export const MARKDOWN_OPTIONS: Pick<Options, 'remarkPlugins' | 'rehypePlugins' | 'urlTransform' | 'skipHtml'> = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [[rehypeSanitize, SANITIZE_SCHEMA]],
  urlTransform: safeUrl,
  // Raw HTML is never rendered; skipping it also drops its text wrapper nodes.
  skipHtml: true,
};

/** True for links that should open in a new tab (absolute http(s) URLs). */
export function isExternalHref(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href);
}
