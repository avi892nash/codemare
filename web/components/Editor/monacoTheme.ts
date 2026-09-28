/**
 * Monaco themes built from the design tokens (app/globals.css) of whatever
 * theme is active where the editor sits. Monaco only understands hex, and
 * the tokens are hex, oklch() and color-mix(), so each token is resolved
 * by the browser (a probe element) and read back through a 1×1 canvas.
 */
import type { editor } from 'monaco-editor';
import type { Theme } from '@/lib/theme';

const TOKENS = {
  bg0: '--bg-0',
  bg1: '--bg-1',
  bg2: '--bg-2',
  bg3: '--bg-3',
  line1: '--line-1',
  line2: '--line-2',
  line3: '--line-3',
  fg0: '--fg-0',
  fg1: '--fg-1',
  fg2: '--fg-2',
  fg3: '--fg-3',
  fg4: '--fg-4',
  accent: '--accent',
  accentBg: '--accent-bg',
  accentLine: '--accent-line',
  err: '--err-fg',
  warn: '--warn-fg',
  info: '--info-fg',
  ok: '--ok-fg',
  kw: '--tk-kw',
  fn: '--tk-fn',
  ty: '--tk-ty',
  st: '--tk-st',
  nu: '--tk-nu',
} as const;

export type TokenColors = Record<keyof typeof TOKENS, string>;

/** Last-resort values (the dark palette) if the browser can't resolve a token. */
const FALLBACK: TokenColors = {
  bg0: '#08080a',
  bg1: '#0e0e11',
  bg2: '#15151a',
  bg3: '#1c1c22',
  line1: '#1d1d24',
  line2: '#28282f',
  line3: '#3a3a44',
  fg0: '#fafafa',
  fg1: '#d4d4d8',
  fg2: '#a1a1aa',
  fg3: '#71717a',
  fg4: '#52525b',
  accent: '#8b93ff',
  accentBg: '#8b93ff24',
  accentLine: '#8b93ff66',
  err: '#ff6b6b',
  warn: '#f5c451',
  info: '#7cc4ec',
  ok: '#5fd68d',
  kw: '#e08bd9',
  fn: '#6cc0f0',
  ty: '#f0c95c',
  st: '#95d07a',
  nu: '#f4a26b',
};

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Resolve every token as rendered inside `scope` (so a <ThemeScope> is honored). */
export function readTokenColors(scope: Element): TokenColors {
  const out = { ...FALLBACK };
  if (typeof document === 'undefined') return out;
  const probe = document.createElement('span');
  // transition:none — a transition on `color` (from any stylesheet) would make
  // getComputedStyle() return the previous token's value instead of this one.
  probe.style.cssText =
    'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;transition:none!important';
  scope.appendChild(probe);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  try {
    for (const [key, cssVar] of Object.entries(TOKENS) as [keyof TokenColors, string][]) {
      probe.style.color = '';
      probe.style.color = `var(${cssVar})`;
      const computed = getComputedStyle(probe).color;
      if (!ctx || !computed) continue;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#010203';
      ctx.fillStyle = computed;
      if (ctx.fillStyle === '#010203' && !/^rgba?\(1, 2, 3/.test(computed)) continue; // unparseable
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      out[key] = `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 255 ? hex2(a) : ''}`;
    }
  } catch {
    // keep what resolved so far
  } finally {
    probe.remove();
  }
  return out;
}

const bare = (hex: string) => hex.replace('#', '').slice(0, 6);
const withAlpha = (hex: string, alpha: number) => `${hex.slice(0, 7)}${hex2(alpha * 255)}`;

export function themeName(theme: Theme): string {
  return `codemare-${theme}`;
}

export function buildMonacoTheme(theme: Theme, c: TokenColors): editor.IStandaloneThemeData {
  return {
    base: theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: bare(c.fg1) },
      { token: 'comment', foreground: bare(c.fg2), fontStyle: 'italic' },
      { token: 'keyword', foreground: bare(c.kw) },
      { token: 'string', foreground: bare(c.st) },
      { token: 'string.escape', foreground: bare(c.nu) },
      { token: 'number', foreground: bare(c.nu) },
      { token: 'regexp', foreground: bare(c.st) },
      { token: 'type', foreground: bare(c.ty) },
      { token: 'type.identifier', foreground: bare(c.ty) },
      { token: 'annotation', foreground: bare(c.ty) },
      { token: 'identifier', foreground: bare(c.fg1) },
      { token: 'predefined', foreground: bare(c.fn) },
      { token: 'function', foreground: bare(c.fn) },
      { token: 'delimiter', foreground: bare(c.fg2) },
      { token: 'operator', foreground: bare(c.fg2) },
      { token: 'tag', foreground: bare(c.kw) },
      { token: 'attribute.name', foreground: bare(c.fn) },
      { token: 'invalid', foreground: bare(c.err) },
    ],
    colors: {
      'editor.background': c.bg1,
      'editor.foreground': c.fg1,
      'editorGutter.background': c.bg1,
      'editorLineNumber.foreground': c.fg4,
      'editorLineNumber.activeForeground': c.fg2,
      'editor.lineHighlightBackground': c.bg2,
      'editor.lineHighlightBorder': c.bg2,
      'editorCursor.foreground': c.accent,
      'editor.selectionBackground': withAlpha(c.accent, theme === 'dark' ? 0.3 : 0.22),
      'editor.inactiveSelectionBackground': withAlpha(c.accent, 0.14),
      'editor.selectionHighlightBackground': withAlpha(c.accent, 0.12),
      'editor.wordHighlightBackground': withAlpha(c.accent, 0.1),
      'editor.findMatchBackground': withAlpha(c.warn, 0.35),
      'editor.findMatchHighlightBackground': withAlpha(c.warn, 0.18),
      'editorBracketMatch.background': withAlpha(c.accent, 0.14),
      'editorBracketMatch.border': c.line3,
      'editorIndentGuide.background1': c.line1,
      'editorIndentGuide.activeBackground1': c.line3,
      'editorWhitespace.foreground': c.line2,
      'editorRuler.foreground': c.line1,
      'editorWidget.background': c.bg2,
      'editorWidget.border': c.line2,
      'editorSuggestWidget.background': c.bg2,
      'editorSuggestWidget.border': c.line2,
      'editorSuggestWidget.foreground': c.fg1,
      'editorSuggestWidget.selectedBackground': c.bg3,
      'editorSuggestWidget.highlightForeground': c.accent,
      'editorHoverWidget.background': c.bg2,
      'editorHoverWidget.border': c.line2,
      'editorError.foreground': c.err,
      'editorWarning.foreground': c.warn,
      'editorInfo.foreground': c.info,
      'editorOverviewRuler.border': c.bg1,
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': withAlpha(c.line3, 0.55),
      'scrollbarSlider.hoverBackground': withAlpha(c.line3, 0.8),
      'scrollbarSlider.activeBackground': c.line3,
      focusBorder: c.accent,
      'input.background': c.bg2,
      'input.border': c.line2,
      'input.foreground': c.fg0,
      'list.hoverBackground': c.bg3,
      'list.activeSelectionBackground': c.bg3,
      'list.activeSelectionForeground': c.fg0,
      'list.highlightForeground': c.accent,
      'widget.shadow': '#00000055',
    },
  };
}
