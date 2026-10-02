import { ArtInView } from '@/components/TopicArt/ArtInView';
import { TopicArt, sceneSrc } from '@/components/TopicArt/TopicArt';
import { Icon } from '@/components/ui/Icon';
import type { TopicCardState } from '@/lib/server/loopViews';
import s from './map.module.css';

/**
 * A topic card's picture: the topic's art at thumbnail size. An unlocked
 * topic's plays — only while the card is on screen, and as a still under
 * reduced motion — and every other state shows the still poster, dimmed, with
 * a small glyph so the state still reads: an open lock for a topic that is
 * ready to unlock, a lock for the rest. The scene is not in the page: the
 * card holds an empty stage and <ArtInView> fetches the scene when the card is
 * near the screen (ten scenes in the HTML and again in the RSC payload were
 * ~30 KB gzipped on the home page). Decorative: the title and the status
 * pill next to it are the accessible name.
 */
export function TopicThumb({ slug, state }: { slug: string; state: TopicCardState }) {
  const playing = state === 'unlocked';
  return (
    <div className={s.thumb} data-state={state} aria-hidden="true">
      <ArtInView src={sceneSrc(slug)}>
        <TopicArt slug={slug} animated={playing} lazy className={s.thumbStage} />
      </ArtInView>
      {!playing && (
        <span className={s.thumbGlyph}>
          <Icon name={state === 'unlockable' ? 'lock-open' : 'lock'} size={11} />
        </span>
      )}
    </div>
  );
}
