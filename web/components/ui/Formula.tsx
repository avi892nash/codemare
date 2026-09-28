import { createElement, type CSSProperties, type ReactNode } from 'react';
import { texToMathML } from './tex';

interface FormulaProps {
  /** TeX source, without the surrounding $$. */
  tex: string;
  /** Equation tag shown at the right, e.g. "(1)". */
  label?: string;
  caption?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Display-math block (`$$ … $$` in lesson markdown). Rendered as native
 * MathML from a TeX subset (see tex.ts) — no KaTeX, nothing to hydrate,
 * screen readers get real math plus the TeX as `alttext`. Anything the
 * subset cannot parse is shown as the raw TeX in mono. Server-safe.
 */
/* Installed OpenType MATH fonts first: the bare `math` generic often maps to a
 * text face, and then stretchy fences ( \left( \right), cases braces, floor)
 * stay small. STIX Two Math ships with macOS; Cambria Math with Windows. */
const MATH_FONTS = "'STIX Two Math', 'Cambria Math', 'Latin Modern Math', 'Noto Sans Math', math";

export function Formula({ tex, label, caption, className, style }: FormulaProps) {
  let body: ReactNode;
  try {
    body = createElement(
      'math',
      { display: 'block', alttext: tex, style: { fontSize: '1.2em', margin: 0, fontFamily: MATH_FONTS } },
      texToMathML(tex, true),
    );
  } catch {
    body = (
      <code className="mono" style={{ display: 'block', textAlign: 'center', fontSize: 13, color: 'var(--fg-1)', whiteSpace: 'pre-wrap' }}>
        {tex}
      </code>
    );
  }

  const Wrapper = caption ? 'figure' : 'div';
  return (
    <Wrapper
      className={className}
      style={{
        margin: '16px 0',
        padding: '14px 16px',
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-md)',
        color: 'var(--fg-0)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Wide formulas scroll sideways on phones; a scroll container must be
            reachable by keyboard (tabIndex) and named. A group, not a region:
            pages hold many formulas and regions must have unique names. */}
        <div
          className="scroll focus-ring"
          tabIndex={0}
          role="group"
          aria-label={label ? `Formula ${label}` : 'Formula'}
          style={{ flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', padding: '2px 0', borderRadius: 'var(--r-sm)' }}
        >
          {body}
        </div>
        {label && (
          <span className="mono" style={{ flex: 'none', fontSize: 12, color: 'var(--fg-2)' }}>
            {label}
          </span>
        )}
      </div>
      {caption && (
        <figcaption style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--fg-2)', textAlign: 'center' }}>
          {caption}
        </figcaption>
      )}
    </Wrapper>
  );
}
