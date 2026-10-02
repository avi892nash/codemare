/**
 * Data behind the topic art: which topics have a scene, what the reel calls
 * them, and each one's hue. Pure data, no JSX — the scenes themselves live in
 * ./scenes/<slug>.tsx and are looked up in ./TopicArt.tsx.
 *
 * Titles and the slug list mirror prisma/seed/data/loop.json; lib/topicArt.test.ts
 * fails when a topic is added there without art, or a title drifts.
 */

export const TOPIC_SLUGS = [
  'arrays-hashing',
  'two-pointers',
  'stack',
  'binary-search',
  'sliding-window',
  'recursion',
  'sorting',
  'graphs',
  'dynamic-programming',
  'heaps-greedy',
] as const;

export type TopicSlug = (typeof TOPIC_SLUGS)[number];

export interface TopicArtMeta {
  slug: string;
  /** The topic's name, as in the catalog. */
  title: string;
  /** One punchy line (≤ 8 words) that says the idea. */
  caption: string;
  /** CSS value of the scene's main hue — an `--art-*` token (globals.css). */
  hue: string;
}

export const TOPIC_ART: Record<TopicSlug, TopicArtMeta> = {
  'arrays-hashing': {
    slug: 'arrays-hashing',
    title: 'Arrays & Hashing',
    caption: 'Skip the search — jump to the bucket',
    hue: 'var(--art-arrays-hashing)',
  },
  'two-pointers': {
    slug: 'two-pointers',
    title: 'Two Pointers',
    caption: 'Two pointers, one meet-in-the-middle',
    hue: 'var(--art-two-pointers)',
  },
  stack: {
    slug: 'stack',
    title: 'Stack',
    caption: 'Last in, first out',
    hue: 'var(--art-stack)',
  },
  'binary-search': {
    slug: 'binary-search',
    title: 'Binary Search',
    caption: 'Guess smarter: halve the pile',
    hue: 'var(--art-binary-search)',
  },
  'sliding-window': {
    slug: 'sliding-window',
    title: 'Sliding Window',
    caption: 'Slide it, don’t restart it',
    hue: 'var(--art-sliding-window)',
  },
  recursion: {
    slug: 'recursion',
    title: 'Recursion & Backtracking',
    caption: 'A problem inside a problem',
    hue: 'var(--art-recursion)',
  },
  sorting: {
    slug: 'sorting',
    title: 'Sorting',
    caption: 'From chaos to order',
    hue: 'var(--art-sorting)',
  },
  graphs: {
    slug: 'graphs',
    title: 'Graphs',
    caption: 'Spread like a rumor (BFS)',
    hue: 'var(--art-graphs)',
  },
  'dynamic-programming': {
    slug: 'dynamic-programming',
    title: 'Dynamic Programming',
    caption: 'Remember it, don’t redo it',
    hue: 'var(--art-dynamic-programming)',
  },
  'heaps-greedy': {
    slug: 'heaps-greedy',
    title: 'Heaps & Greedy',
    caption: 'The best one floats to the top',
    hue: 'var(--art-heaps-greedy)',
  },
};

/**
 * The order the sign-in reel plays them in (and its switcher lists them).
 * Binary search leads — it is the first scene a visitor sees, so the server
 * and the browser agree on it — and neighbours differ in hue and layout.
 */
export const HERO_ORDER: readonly TopicSlug[] = [
  'binary-search',
  'arrays-hashing',
  'stack',
  'graphs',
  'two-pointers',
  'dynamic-programming',
  'sliding-window',
  'recursion',
  'sorting',
  'heaps-greedy',
];

export function isTopicSlug(slug: string): slug is TopicSlug {
  return Object.prototype.hasOwnProperty.call(TOPIC_ART, slug);
}

/** Meta for any slug: unknown topics get a neutral entry in the accent hue. */
export function topicMeta(slug: string): TopicArtMeta {
  if (isTopicSlug(slug)) return TOPIC_ART[slug];
  return { slug, title: slug, caption: '', hue: 'var(--art-fallback)' };
}
