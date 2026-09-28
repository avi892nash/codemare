import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logomark } from '@/components/ui/Logomark';
import { Pill } from '@/components/ui/Pill';
import { ThemeScope } from '@/components/ui/ThemeScope';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { SECTIONS } from './sections';
import { SystemSheet } from './SystemSheet';
import s from './system.module.css';

const isProd = process.env.NODE_ENV === 'production';

/* The layout already 404s in production; doing it here too keeps the page's
 * title from leaking onto the production 404. */
export async function generateMetadata(): Promise<Metadata> {
  if (isProd) notFound();
  return { title: 'System · Codemare' };
}

/**
 * Artboards "00 · System · dark/light": every UI-kit component rendered in
 * both themes side by side (stacked below 1100 px). Each column is a pinned
 * <ThemeScope>, so the page chrome follows your theme while the columns
 * don't. Non-production only — see app/dev/layout.tsx.
 */
export default function SystemPage() {
  if (isProd) notFound();
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Link href="/" aria-label="Codemare home" className="focus-ring" style={{ display: 'inline-flex', borderRadius: 6 }}>
          <Logomark />
        </Link>
        <span className={s.topTitle}>Design system</span>
        <span className={s.topMeta}>components/ui · components/states · tokens in app/globals.css</span>
        <nav className={s.topLinks} aria-label="Theme columns">
          <a className={`${s.topLink} focus-ring`} href="#dark-colors">Dark</a>
          <a className={`${s.topLink} focus-ring`} href="#light-colors">Light</a>
          <ThemeToggle />
        </nav>
      </header>

      <main>
        <div className={s.intro}>
          <h1>Codemare · System</h1>
          <p>
            Tokens, type, and every component in the kit, rendered in the dark theme (<span className="mono">.cm</span>)
            and the light theme (<span className="mono">.cm.cm-light</span>). All controls are live: tab through them,
            open the modal, fire a toast, run the snippet, step the visualization.
          </p>
          <nav className={s.toc} aria-label="Sections">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#dark-${id}`} className="focus-ring" style={{ borderRadius: 999, textDecoration: 'none' }}>
                <Pill tone="muted" size="xs">{label}</Pill>
              </a>
            ))}
          </nav>
        </div>

        <div className={s.columns}>
          <ThemeScope theme="dark" as="section" className={s.column} aria-labelledby="col-dark">
            <div className={s.columnHead}>
              <h2 id="col-dark">Dark</h2>
              <Pill tone="muted" size="xs" className="mono">.cm</Pill>
            </div>
            <SystemSheet theme="dark" />
          </ThemeScope>
          <ThemeScope theme="light" as="section" className={s.column} aria-labelledby="col-light">
            <div className={s.columnHead}>
              <h2 id="col-light">Light</h2>
              <Pill tone="muted" size="xs" className="mono">.cm.cm-light</Pill>
            </div>
            <SystemSheet theme="light" />
          </ThemeScope>
        </div>
      </main>
    </div>
  );
}
