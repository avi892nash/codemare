import { HeroReel } from '../TopicArt/HeroReel';
import { HERO_ORDER, TOPIC_ART } from '../TopicArt/art';
import { TopicScene } from '../TopicArt/TopicArt';
import { Icon, type IconName } from '../ui/Icon';
import s from './Auth.module.css';

/**
 * Right-hand panel on the auth screens: what Codemare is, shown instead of
 * told — an animated scene per topic (the hero reel, one client component that
 * only chooses which server-rendered scene is mounted) and three chips for the
 * product's hooks: µs-timed judging, topics you unlock as you go, every run
 * kept. On narrow screens the panel becomes a short banner above the form
 * (.auth-panel in globals.css lifts it with `order`; the chips drop out below
 * 640 px). Its content is one column, centered in the panel. Server component.
 */
const CHIPS: Array<{ icon: IconName; label: string }> = [
  { icon: 'bolt', label: 'Judged in microseconds' },
  { icon: 'map', label: 'Unlock as you go' },
  { icon: 'history', label: 'Track every run' },
];

export function AuthValuePanel() {
  const topics = HERO_ORDER.map((slug) => TOPIC_ART[slug]);
  const scenes = Object.fromEntries(HERO_ORDER.map((slug) => [slug, <TopicScene key={slug} slug={slug} />]));
  return (
    <aside aria-label="About Codemare" className={`auth-panel ${s.panel}`}>
      <div aria-hidden className={s.panelGlow} />
      <div className={s.panelBody}>
        <HeroReel topics={topics} scenes={scenes} />
        <ul className={s.chips}>
          {CHIPS.map((c) => (
            <li key={c.label} className={s.chip}>
              <Icon name={c.icon} size={14} />
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
