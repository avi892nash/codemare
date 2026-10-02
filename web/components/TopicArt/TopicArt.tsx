import type { CSSProperties, ReactElement } from 'react';
import { LOOP_MS } from '@/lib/client/heroReel';
import { isTopicSlug, topicMeta, type TopicSlug } from './art';
import { toMarkup } from './markup';
import { ArraysHashingScene } from './scenes/arrays-hashing';
import { BinarySearchScene } from './scenes/binary-search';
import { RecursionScene } from './scenes/recursion';
import { SlidingWindowScene } from './scenes/sliding-window';
import { SortingScene } from './scenes/sorting';
import { StackScene } from './scenes/stack';
import { TwoPointersScene } from './scenes/two-pointers';
import { DynamicProgrammingScene } from './scenes/dynamic-programming';
import { FallbackScene } from './scenes/fallback';
import { GraphsScene } from './scenes/graphs';
import { HeapsGreedyScene } from './scenes/heaps-greedy';
import st from './stage.module.css';
import s from './topicArt.module.css';

/**
 * The topic art: one animated SVG scene per topic slug, drawn on a stage.
 * `<TopicArt slug="binary-search" />` fills its container (16:9, reserved with
 * aspect-ratio, so there is no layout shift) and loops on its own. Scenes are
 * plain server components — no client JS; the sign-in hero reel
 * (HeroReel.tsx) is the only client part and just chooses which one is mounted.
 *
 * Every scene is drawn on a 320×180 canvas, keeps its story inside the middle
 * ~280×140 and reads at 280×160 and 120×80. An unknown slug gets the fallback
 * scene in the accent color, so a topic added to the catalog never breaks a page.
 */

export const SCENES: Record<TopicSlug, () => ReactElement> = {
  'arrays-hashing': ArraysHashingScene,
  'two-pointers': TwoPointersScene,
  stack: StackScene,
  'binary-search': BinarySearchScene,
  'sliding-window': SlidingWindowScene,
  recursion: RecursionScene,
  sorting: SortingScene,
  graphs: GraphsScene,
  'dynamic-programming': DynamicProgrammingScene,
  'heaps-greedy': HeapsGreedyScene,
};

export const VIEWBOX = '0 0 320 180';

const markup = new Map<string, string>();

/** A scene's SVG content as markup, built once: the scenes are static, so every use of a slug shares one string. */
function sceneMarkup(slug: string): string {
  let m = markup.get(slug);
  if (m === undefined) {
    const Scene = isTopicSlug(slug) ? SCENES[slug] : FallbackScene;
    m = toMarkup(Scene());
    markup.set(slug, m);
  }
  return m;
}

/**
 * The scene's SVG plus its glow, without the stage — what the hero reel mounts
 * in its layers. The SVG's content is the scene turned into markup on the
 * server (see markup.ts), so the page carries each scene once, as a string.
 */
export function TopicScene({ slug }: { slug: string }) {
  return (
    <>
      <span className={st.glow} />
      <svg
        className={s.svg}
        viewBox={VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: sceneMarkup(slug) }}
      />
    </>
  );
}

export interface TopicArtProps {
  /** A topic slug from the catalog; unknown slugs get the fallback scene. */
  slug: string;
  /** false = a still poster frame (the scene at its payoff) instead of the loop. Default true. */
  animated?: boolean;
  /** Freeze the loop where it is (e.g. while a card is not hovered). */
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The art for one topic, on its stage. Decorative: hidden from assistive tech, so label the topic next to it. */
export function TopicArt({ slug, animated = true, paused = false, className, style }: TopicArtProps) {
  const { hue } = topicMeta(slug);
  return (
    <div
      className={`${st.stage} ${st.hue}${className ? ` ${className}` : ''}`}
      style={{ '--a': hue, '--L': `${LOOP_MS}ms`, ...style } as CSSProperties}
      data-topic={slug}
      data-motion={animated ? undefined : 'off'}
      data-paused={paused ? '' : undefined}
      aria-hidden="true"
    >
      <div className={st.layer}>
        <TopicScene slug={slug} />
      </div>
    </div>
  );
}
