import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HERO_ORDER, topicMeta } from '@/components/TopicArt/art';
import { TopicArt } from '@/components/TopicArt/TopicArt';
import { Logomark } from '@/components/ui/Logomark';
import { ThemeScope } from '@/components/ui/ThemeScope';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import s from './gallery.module.css';

const isProd = process.env.NODE_ENV === 'production';

/* The layout already 404s in production; doing it here too keeps the page's
 * title from leaking onto the production 404. */
export async function generateMetadata(): Promise<Metadata> {
  if (isProd) notFound();
  return { title: 'Topic art · Codemare' };
}

const SLUGS = [...HERO_ORDER, 'not-a-topic'];

function Sheet({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div className={s.sheet}>
      {SLUGS.map((slug) => {
        const meta = topicMeta(slug);
        return (
          <article key={slug} className={s.card} data-testid={`gallery-${theme}-${slug}`}>
            <header className={s.cardHead}>
              <h3>{slug === 'not-a-topic' ? 'Fallback (unknown slug)' : meta.title}</h3>
              <span className="mono">{slug}</span>
              {meta.caption && <p>{meta.caption}</p>}
            </header>
            <div className={s.hero}><TopicArt slug={slug} /></div>
            <div className={s.small}>
              <figure style={{ width: 280 }}>
                <TopicArt slug={slug} style={{ height: 160, aspectRatio: 'auto' }} />
                <figcaption className="mono">280 × 160</figcaption>
              </figure>
              <figure style={{ width: 120 }}>
                <TopicArt slug={slug} style={{ height: 80, aspectRatio: 'auto', borderRadius: 10 }} />
                <figcaption className="mono">120 × 80</figcaption>
              </figure>
              <figure style={{ width: 120 }}>
                <TopicArt slug={slug} animated={false} style={{ height: 80, aspectRatio: 'auto', borderRadius: 10 }} />
                <figcaption className="mono">poster</figcaption>
              </figure>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/**
 * Every topic scene at hero size, at card sizes (280×160, 120×80) and as its
 * still poster frame, in both themes side by side (each column is a pinned
 * <ThemeScope>, like /dev/system). Non-production only — see app/dev/layout.tsx.
 */
export default function TopicArtGalleryPage() {
  if (isProd) notFound();
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link href="/" aria-label="Codemare home" className="focus-ring" style={{ display: 'inline-flex', borderRadius: 6 }}>
          <Logomark />
        </Link>
        <span className={s.topTitle}>Topic art</span>
        <span className={s.topMeta}>components/TopicArt · tokens: --art-* in app/globals.css</span>
        <nav className={s.topLinks} aria-label="Theme columns">
          <a className={`${s.topLink} focus-ring`} href="#dark">Dark</a>
          <a className={`${s.topLink} focus-ring`} href="#light">Light</a>
          <ThemeToggle />
        </nav>
      </header>
      <main>
        <div className={s.intro}>
          <h1>Codemare · Topic art</h1>
          <p>
            One animated SVG scene per topic, looping every 7 s with a payoff (confetti and a +1 token) at the end. Each is
            shown at hero size, at card size (280 × 160, 120 × 80) and as the still poster frame that reduced-motion users get.
          </p>
        </div>
        <div className={s.columns}>
          <ThemeScope theme="dark" as="section" className={s.column} id="dark" aria-label="Dark theme">
            <Sheet theme="dark" />
          </ThemeScope>
          <ThemeScope theme="light" as="section" className={s.column} id="light" aria-label="Light theme">
            <Sheet theme="light" />
          </ThemeScope>
        </div>
      </main>
    </div>
  );
}
