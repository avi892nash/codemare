import { ArtInView } from '@/components/TopicArt/ArtInView';
import { TopicArt, sceneSrc } from '@/components/TopicArt/TopicArt';
import type { TopicCardState } from '@/lib/server/loopViews';
import s from './map.module.css';

/**
 * A topic's picture at row size: the topic's art as a still poster (the
 * scene at its payoff), never animated — the page's one moving picture is
 * the hero's. A topic that is not open yet is dimmed, which is all its state
 * adds to the picture: the label next to it carries the words. The scene is
 * not in the page: the row holds an empty stage and <ArtInView> fetches the
 * scene when the row is near the screen (ten scenes in the HTML and again in
 * the RSC payload were ~30 KB gzipped on the home page). Decorative: the
 * title beside it is the accessible name.
 */
export function TopicThumb({ slug, state, size = 'md' }: { slug: string; state: TopicCardState; size?: 'md' | 'sm' }) {
  return (
    <div className={s.thumb} data-state={state} data-size={size} aria-hidden="true">
      <ArtInView src={sceneSrc(slug)}>
        <TopicArt slug={slug} animated={false} lazy className={s.thumbStage} />
      </ArtInView>
    </div>
  );
}
