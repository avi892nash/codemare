import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import loop from '@/prisma/seed/data/loop.json';
import { HERO_ORDER, TOPIC_ART, TOPIC_SLUGS, isTopicSlug, topicMeta } from '@/components/TopicArt/art';
import { expandKeyframes, loopSeconds } from '@/components/TopicArt/kfx';
import { toMarkup } from '@/components/TopicArt/markup';
import { SCENES, TopicArt, TopicScene } from '@/components/TopicArt/TopicArt';
import { FallbackScene } from '@/components/TopicArt/scenes/fallback';
import { LOOP_MS } from '@/lib/client/heroReel';

// vitest answers any CSS-module key with a made-up name, so a misspelled class would pass unnoticed. Here
// the stylesheet is read for what it really defines: a name it lacks comes back undefined, as in production, and is recorded.
const sheet = vi.hoisted(() => ({
  missing: new Set<string>(),
  names(css: string): Set<string> {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return new Set([...code.matchAll(/\.([A-Za-z_][\w-]*)/g), ...code.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  },
}));
vi.mock('@/components/TopicArt/topicArt.module.css', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const defined = sheet.names(readFileSync(fileURLToPath(new URL('../components/TopicArt/topicArt.module.css', import.meta.url)), 'utf8'));
  const classes = new Proxy({} as Record<string, string | undefined>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (defined.has(key)) return key;
      sheet.missing.add(key);
      return undefined;
    },
  });
  return { default: classes };
});

/**
 * The topic art must keep up with the catalog: a topic added to
 * prisma/seed/data/loop.json without a scene (or with a different name) fails
 * here, and every scene must stay small, honest SVG decoration.
 */

const topics = loop.topics as Array<{ slug: string; title: string }>;

describe('topic art covers the catalog', () => {
  it('has a scene, a name, a caption and a hue for every topic in loop.json', () => {
    for (const t of topics) {
      expect(isTopicSlug(t.slug), `${t.slug} has no art — add components/TopicArt/scenes/${t.slug}.tsx and register it`).toBe(true);
      expect(typeof SCENES[t.slug as keyof typeof SCENES], t.slug).toBe('function');
      const meta = TOPIC_ART[t.slug as keyof typeof TOPIC_ART];
      expect(meta.title, `${t.slug}: title differs from the catalog`).toBe(t.title);
      expect(meta.hue).toBe(`var(--art-${t.slug})`);
      expect(meta.caption.length).toBeGreaterThan(5);
      expect(meta.caption.split(/\s+/).length, `${t.slug}: caption should be 8 words or fewer`).toBeLessThanOrEqual(8);
    }
  });

  it('has no art for topics that are not in the catalog', () => {
    expect([...TOPIC_SLUGS].sort()).toEqual(topics.map((t) => t.slug).sort());
    expect(Object.keys(SCENES).sort()).toEqual(topics.map((t) => t.slug).sort());
  });

  it('plays every topic once in the hero reel, starting with binary search', () => {
    expect([...HERO_ORDER].sort()).toEqual([...TOPIC_SLUGS].sort());
    expect(HERO_ORDER[0]).toBe('binary-search');
  });

  it('gives an unknown slug a neutral entry and the fallback scene', () => {
    expect(isTopicSlug('not-a-topic')).toBe(false);
    expect(topicMeta('not-a-topic')).toMatchObject({ slug: 'not-a-topic', hue: 'var(--art-fallback)' });
    const html = renderToStaticMarkup(createElement(TopicScene, { slug: 'not-a-topic' }));
    expect(html).toContain('viewBox="0 0 320 180"');
    expect(html).toContain(toMarkup(FallbackScene()).slice(0, 80));
  });
});

describe.each([...TOPIC_SLUGS, 'fallback'] as string[])('scene %s', (slug) => {
  const scene = slug === 'fallback' ? FallbackScene : SCENES[slug as keyof typeof SCENES];
  const markup = toMarkup(scene());

  it('is deterministic and not empty', () => {
    expect(markup.length).toBeGreaterThan(500);
    expect(toMarkup(scene())).toBe(markup);
  });

  it('serializes exactly like React does', () => {
    // React closes every element explicitly; the serializer self-closes the empty ones (valid in inline SVG, and shorter).
    // It also single-quotes attribute values (smaller inside the RSC payload's JSON).
    const react = renderToStaticMarkup(scene())
      .replace(/<(rect|circle|path|line|g|text)([^>]*)><\/\1>/g, '<$1$2/>')
      .replace(/="([^"]*)"/g, "='$1'");
    expect(markup).toBe(react);
  });

  it('is small: well under the budget for ten scenes', () => {
    expect(markup.length, `${slug} markup is ${markup.length} bytes`).toBeLessThan(15_000);
  });

  it('draws with SVG shapes and text only, and no sentences', () => {
    const tags = new Set([...markup.matchAll(/<([a-z]+)/g)].map((m) => m[1]));
    expect([...tags].filter((t) => !['g', 'rect', 'circle', 'path', 'line', 'text'].includes(t))).toEqual([]);
    for (const m of markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
      expect(m[1].length, `text "${m[1]}" is too long for a label`).toBeLessThanOrEqual(8);
    }
  });

  it('takes every color from the theme (no literal colors)', () => {
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(markup).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/);
  });

  it('keeps a reduced-motion poster: no element is hidden by default', () => {
    // transient things (confetti, rings) start at opacity 0 in the CSS, not inline; inline opacity 0 is allowed only for parts the poster leaves out on purpose
    const hidden = [...markup.matchAll(/style="[^"]*\bopacity:0\b[^"]*"/g)].length;
    expect(hidden).toBeLessThanOrEqual(24);
  });
});

describe('the ten scenes together', () => {
  it('stay under ~80 KB of markup', () => {
    // About 77 KB raw, 8 KB gzipped, sent once per sign-in page. The cap is a tripwire for scenes that grow by accident, not a target.
    const total = TOPIC_SLUGS.reduce((n, slug) => n + toMarkup(SCENES[slug]()).length, 0);
    expect(total, `ten scenes are ${total} bytes`).toBeLessThan(80_000);
  });
});

describe('the stylesheet', () => {
  const dir = fileURLToPath(new URL('../components/TopicArt/', import.meta.url));
  const css = readFileSync(join(dir, 'topicArt.module.css'), 'utf8');

  it('has its generated keyframes in step with their specs', () => {
    // Fails after a spec is edited and the file was not regenerated: npx tsx components/TopicArt/kfx.ts components/TopicArt/topicArt.module.css
    expect(expandKeyframes(css)).toBe(css);
  });

  it('is written for the loop length the scenes and the reel use', () => {
    expect(loopSeconds(css) * 1000).toBe(LOOP_MS);
  });

  it('defines every class and keyframe name the scenes ask for', () => {
    // A misspelled s.name is undefined at run time: the element silently loses its look.
    const defined = sheet.names(css);
    const files = [join(dir, 'TopicArt.tsx'), ...readdirSync(join(dir, 'scenes')).map((f) => join(dir, 'scenes', f))];
    const used = new Set<string>();
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bs\.([A-Za-z_]\w*)/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bs\['([\w-]+)'\]/g)) used.add(m[1]);
      for (const m of src.matchAll(/\bxs: '(k\w+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    // The numbered keyframes a scene picks at run time (s[`kStk${k}`]): rendering every scene above touched them all.
    expect([...sheet.missing]).toEqual([]);
  });
});

describe('<TopicArt>', () => {
  it('renders a decorative, labelled-by-its-neighbour stage with the scene inside', () => {
    const html = renderToStaticMarkup(createElement(TopicArt, { slug: 'graphs' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-topic="graphs"');
    expect(html).toContain('--a:var(--art-graphs)');
    expect(html).toContain('<svg');
    expect(html).not.toContain('data-motion');
  });

  it('can be a still poster or paused', () => {
    expect(renderToStaticMarkup(createElement(TopicArt, { slug: 'stack', animated: false }))).toContain('data-motion="off"');
    expect(renderToStaticMarkup(createElement(TopicArt, { slug: 'stack', paused: true }))).toContain('data-paused=""');
  });
});
