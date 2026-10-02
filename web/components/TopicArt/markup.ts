import { Fragment, isValidElement, type ReactNode } from 'react';

/**
 * Turns a scene's element tree into SVG markup, on the server.
 *
 * The scenes are written as small React components (readable, typed, each
 * built from the helpers in parts.tsx), but they are static: no hooks, no
 * state, no events. Handing their element trees to React as props would make
 * the page carry every scene twice — as HTML and as RSC payload, which is
 * about twice the size of the HTML again — and make the browser rebuild ten
 * trees of ~170 elements at hydration to show one. A string is sent once, and
 * the client reel drops it in with innerHTML.
 *
 * It handles exactly what the scenes use — fragments, function components,
 * host elements, text, className / style / camelCase SVG attributes (written
 * with single quotes) — and
 * lib/topicArt.test.ts checks its output against React's own server renderer
 * for every scene, so a feature added to a scene that this does not know about
 * fails the test instead of rendering wrong.
 */

const ATTR: Record<string, string> = {
  className: 'class',
  fontSize: 'font-size',
  strokeWidth: 'stroke-width',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;' };
// Attribute values are single-quoted: the markup travels inside a JSON string (the RSC payload), where a double quote costs a backslash.
const esc = (v: string) => v.replace(/[&<>']/g, (c) => ESC[c]);
const escText = (v: string) => v.replace(/[&<>]/g, (c) => ESC[c]);
const kebab = (k: string) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

function style(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
    .map(([k, v]) => `${kebab(k)}:${v}`)
    .join(';');
}

/** The markup of `node`. Elements with no children are self-closed (valid in inline SVG). */
export function toMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return escText(node);
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(toMarkup).join('');
  if (!isValidElement(node)) throw new Error('toMarkup: not a React element');
  const { type, props } = node as { type: unknown; props: Record<string, unknown> };
  if (type === Fragment) return toMarkup(props.children as ReactNode);
  if (typeof type === 'function') return toMarkup((type as (p: unknown) => ReactNode)(props));
  if (typeof type !== 'string') throw new Error('toMarkup: unsupported element type');

  let attrs = '';
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || v === undefined || v === null || v === false) continue;
    if (k === 'style') {
      const css = style(v as Record<string, unknown>);
      if (css) attrs += ` style='${esc(css)}'`;
    } else {
      attrs += ` ${ATTR[k] ?? k}='${esc(String(v))}'`;
    }
  }
  const inner = toMarkup(props.children as ReactNode);
  return inner ? `<${type}${attrs}>${inner}</${type}>` : `<${type}${attrs}/>`;
}
