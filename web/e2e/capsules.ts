import type { Page } from '@playwright/test';

/**
 * The "tags" the calm pages replaced with plain words: filled or outlined, pill-shaped things that carry text — a
 * difficulty pill, a verdict code capsule, a topic chip, a cost chip. Buttons, links, tabs and form controls are
 * controls, not tags (a tab strip drawn as pills is fine); avatar initials and the like (aria-hidden, two characters
 * or fewer) are marks; the top bar is outside <main>.
 *
 * Runs in the page. Each hit is described as `"text" (tag.class)` so a failure says where to look.
 */
function findCapsules(rootSelector: string): string[] {
  const found: string[] = [];
  const alpha = (color: string): number => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return color === 'transparent' ? 0 : 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? parseFloat(parts[3]) : 1;
  };
  for (const el of document.querySelectorAll<HTMLElement>(`${rootSelector} *`)) {
    if (el.closest('button, a, input, select, textarea, summary, label, [role="tab"], [role="tablist"], [role="switch"], svg, .monaco-editor, script, style')) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 48) continue;
    if (el.closest('[aria-hidden="true"]') && text.length <= 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.height > 44) continue;
    // fully rounded ends on a shape wider than it is tall (a circle with a number in it is a marker, not a tag)
    const pill = parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 0.5 && r.width > r.height * 1.25;
    const filled = alpha(cs.backgroundColor) > 0.04;
    const outlined = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && alpha(cs.borderTopColor) > 0.04;
    if (pill && (filled || outlined)) found.push(`"${text.slice(0, 32)}" (${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''})`);
  }
  return found;
}

/** Pill-shaped tags on the page's content (see findCapsules). Empty on a calm page. */
export async function capsules(page: Page, rootSelector = 'main'): Promise<string[]> {
  return page.evaluate(findCapsules, rootSelector);
}
