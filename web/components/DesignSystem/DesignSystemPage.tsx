'use client';

import { useState } from 'react';
import { Pill } from '../ui/Pill';
import { PaletteSection } from './sections/PaletteSection';
import { TypeSection } from './sections/TypeSection';
import { NumericsSection } from './sections/NumericsSection';
import { StatusPillsSection } from './sections/StatusPillsSection';
import { MetricChipsSection } from './sections/MetricChipsSection';
import { ButtonsSection } from './sections/ButtonsSection';
import { FormControlsSection } from './sections/FormControlsSection';
import { CodeBlockSection } from './sections/CodeBlockSection';

/**
 * The kit page. Each numbered section is its own component under
 * components/DesignSystem/sections/. The page itself only owns the page-frame
 * (header, theme toggle, 12-column grid) and the section ordering.
 */
export function DesignSystemPage() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  return (
    <div
      className={theme === 'light' ? 'cm-light' : ''}
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
      }}
    >
      <div style={{ padding: '44px 56px 56px', maxWidth: 1500, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: 36,
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--fg-3)',
                letterSpacing: 1.6,
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Codemare · Design System
            </div>
            <h1
              style={{
                margin: '6px 0 0',
                fontSize: 36,
                fontWeight: 600,
                letterSpacing: -0.6,
                lineHeight: 1.05,
              }}
            >
              The kit. <span style={{ color: 'var(--fg-3)' }}>Tokens, type, components — {theme}.</span>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pill tone="muted" size="md">v0.4</Pill>
            <button
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="focus-ring"
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '6px 12px',
                background: 'var(--bg-2)',
                color: 'var(--fg-0)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                cursor: 'pointer',
              }}
              title="Toggle theme"
            >
              {theme === 'dark' ? '☾ Dark · primary' : '☀ Light · supported'}
            </button>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 36, rowGap: 56 }}>
          <PaletteSection />
          <TypeSection />
          <NumericsSection />
          <StatusPillsSection />
          <MetricChipsSection />
          <ButtonsSection />
          <FormControlsSection />
          <CodeBlockSection />
        </div>
      </div>
    </div>
  );
}
