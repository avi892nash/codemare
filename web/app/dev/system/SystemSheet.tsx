'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Theme } from '@/lib/theme';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button, ButtonLink, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Chip } from '@/components/ui/Chip';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Formula } from '@/components/ui/Formula';
import { Icon, ICON_NAMES } from '@/components/ui/Icon';
import { Input, Textarea } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RunnableCodeBlock, type RunCode } from '@/components/ui/RunnableCodeBlock';
import { Select } from '@/components/ui/Select';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { StatusPill, VERDICTS } from '@/components/ui/StatusPill';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { useToast } from '@/components/ui/Toast';
import { LANGUAGE_LABEL, type CodeLanguage } from '@/components/ui/highlight';
import { EmptyState } from '@/components/states/EmptyState';
import { EditorSkeleton, ListPageSkeleton } from '@/components/states/LoadingState';
import { NotFound } from '@/components/states/NotFound';
import { ServerError } from '@/components/states/ServerError';
import { BinarySearchViz } from './BinarySearchViz';
import type { SectionKey } from './sections';
import s from './system.module.css';

function Section({ theme, id, title, note, children }: { theme: Theme; id: SectionKey; title: string; note?: string; children: ReactNode }) {
  return (
    // Named "<title> <theme>" (the column heading) so the dark and light copies are distinct landmarks.
    <section id={`${theme}-${id}`} className={s.section} aria-labelledby={`${theme}-${id}-h col-${theme}`}>
      <div className={s.sectionHead}>
        <h3 id={`${theme}-${id}-h`}>{title}</h3>
        {note && <span>{note}</span>}
      </div>
      {children}
    </section>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <div className={s.sub}>{children}</div>;

/* ── Tokens ─────────────────────────────────────────────────────── */

const TOKEN_GROUPS: Array<[string, string[]]> = [
  ['Surfaces', ['--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-4']],
  ['Lines', ['--line-1', '--line-2', '--line-3']],
  ['Text', ['--fg-0', '--fg-1', '--fg-2', '--fg-3', '--fg-4']],
  ['Accent', ['--accent', '--accent-hi', '--accent-lo', '--accent-bg', '--accent-line', '--on-accent']],
  ['Status', ['--ok', '--ok-bg', '--ok-fg', '--warn', '--warn-bg', '--warn-fg', '--err', '--err-bg', '--err-fg', '--info', '--info-bg', '--info-fg']],
  ['Diff & syntax', ['--diff-add', '--diff-del', '--tk-kw', '--tk-fn', '--tk-ty', '--tk-st', '--tk-nu']],
];

const ALL_TOKENS = TOKEN_GROUPS.flatMap(([, n]) => n);

/** Read the tokens' computed values inside this column's theme scope. */
function useTokenValues(scope: React.RefObject<HTMLElement>) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!scope.current) return;
    const cs = getComputedStyle(scope.current);
    setValues(Object.fromEntries(ALL_TOKENS.map((n) => [n, cs.getPropertyValue(n).trim()])));
  }, [scope]);
  return values;
}

function Colors({ scope }: { scope: React.RefObject<HTMLElement> }) {
  const values = useTokenValues(scope);
  return (
    <div className={s.stack}>
      {TOKEN_GROUPS.map(([group, names]) => (
        <div key={group}>
          <Sub>{group}</Sub>
          <div className={s.swatches}>
            {names.map((n) => (
              <div key={n} className={s.swatch}>
                <span className={s.chip} style={{ background: `var(${n})` }} />
                <span className={s.swatchText}>
                  <span className={`${s.swatchName} mono`}>{n}</span>
                  <span className={`${s.swatchValue} mono`} title={values[n]}>{values[n] || '…'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div>
        <Sub>Radii</Sub>
        <div className={s.row}>
          {['--r-sm', '--r', '--r-md', '--r-lg', '--r-xl'].map((r) => (
            <Pill key={r} tone="muted" className="mono">{r}</Pill>
          ))}
        </div>
      </div>
    </div>
  );
}

/* WCAG contrast, measured live: each color is painted on a 1×1 canvas over
 * its surface and read back as sRGB, so oklch() and color-mix() tokens are
 * resolved exactly as the browser shows them. */
const TEXT_TOKENS = ['--fg-0', '--fg-1', '--fg-2', '--fg-3', '--fg-4', '--accent-hi', '--ok', '--ok-fg', '--warn', '--warn-fg', '--err', '--err-fg', '--info', '--info-fg'];
const SURFACES = ['--bg-0', '--bg-1', '--bg-2', '--bg-3'];

function luminance([r, g, b]: number[]) {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function Contrast({ scope }: { scope: React.RefObject<HTMLElement> }) {
  const [table, setTable] = useState<number[][] | null>(null);
  useEffect(() => {
    const el = scope.current;
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!el || !ctx) return;
    const cs = getComputedStyle(el);
    const paint = (...layers: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const c of layers) {
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
      }
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const v = (n: string) => cs.getPropertyValue(n).trim();
    setTable(
      TEXT_TOKENS.map((t) =>
        SURFACES.map((bg) => {
          const L1 = luminance(paint(v(bg)));
          const L2 = luminance(paint(v(bg), v(t)));
          const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
          return (hi + 0.05) / (lo + 0.05);
        }),
      ),
    );
  }, [scope]);

  return (
    <div className="scroll" style={{ overflowX: 'auto' }}>
      <table className={s.contrast}>
        <caption className="sr-only">Contrast ratio of text tokens on surfaces</caption>
        <thead>
          <tr>
            <th scope="col">text \ surface</th>
            {SURFACES.map((b) => <th key={b} scope="col" className="mono">{b}</th>)}
          </tr>
        </thead>
        <tbody>
          {TEXT_TOKENS.map((t, i) => (
            <tr key={t}>
              <th scope="row" className="mono" style={{ color: `var(${t})`, fontWeight: 500 }}>{t}</th>
              {SURFACES.map((b, j) => {
                const r = table?.[i]?.[j];
                const tone = r == null ? 'var(--fg-2)' : r >= 4.5 ? 'var(--ok-fg)' : r >= 3 ? 'var(--warn-fg)' : 'var(--err-fg)';
                return (
                  <td key={b} className="mono" style={{ color: tone }}>
                    {r == null ? '…' : `${r.toFixed(2)} ${r >= 4.5 ? 'AA' : r >= 3 ? 'large' : 'fail'}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>
        AA body text needs 4.5:1; “large” (≥ 3:1) is only for ≥ 18.66 px bold / 24 px text and UI graphics.
        Small text uses fg-0…fg-2, accent-hi and the <span className="mono">*-fg</span> tones.
      </p>
    </div>
  );
}

function TypeScale() {
  const rows: Array<[string, React.CSSProperties, string]> = [
    ['Display · 30/600', { fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }, 'Train on real problems.'],
    ['H1 · 28/600', { fontSize: 28, fontWeight: 600, letterSpacing: -0.4 }, 'Submissions'],
    ['H2 · 22/600', { fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }, 'Two Sum'],
    ['H3 · 16/600', { fontSize: 16, fontWeight: 600, letterSpacing: -0.2 }, 'Problems'],
    ['Body · 14/1.65', { fontSize: 14, lineHeight: 1.65, color: 'var(--fg-1)' }, 'Given an array of integers, return indices…'],
    ['UI · 13/500', { fontSize: 13, fontWeight: 500 }, 'Run · Submit · Reset'],
    ['Small · 12.5', { fontSize: 12.5, color: 'var(--fg-2)' }, 'Last 100 runs across every problem.'],
    ['Label · 11/600 caps', { fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--fg-2)' }, 'Test results'],
    ['Mono · 12.5', { fontSize: 12.5, fontFamily: 'var(--font-mono)' }, 'O(n log n) · 12.4 ms · 9,216 KB'],
    ['Metric · mono 28', { fontSize: 28, fontFamily: 'var(--font-mono)', fontWeight: 500, letterSpacing: -0.5 }, '0.84 ms'],
  ];
  return (
    <div>
      {rows.map(([meta, style, text]) => (
        <div key={meta} className={s.typeRow}>
          <span className={`${s.typeMeta} mono`}>{meta}</span>
          <span className={s.typeSample} style={style}>{text}</span>
        </div>
      ))}
    </div>
  );
}

function Radii() {
  return (
    <div className={s.stack}>
      <div className={s.radii}>
        {[['--r-sm', '4'], ['--r', '6'], ['--r-md', '8'], ['--r-lg', '12'], ['--r-xl', '16']].map(([r, px]) => (
          <div key={r} className={`${s.radius} mono`} style={{ borderRadius: `var(${r})` }}>{px}px</div>
        ))}
      </div>
      <div className={s.row} style={{ gap: 16 }}>
        {['--shadow-sm', '--shadow', '--shadow-lg'].map((sh) => (
          <div key={sh} className={`${s.shadow} mono`} style={{ boxShadow: `var(${sh})` }}>{sh}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Controls ───────────────────────────────────────────────────── */

const VARIANTS: ButtonVariant[] = ['primary', 'default', 'ghost', 'outline', 'accent', 'success', 'danger'];
const SIZES: ButtonSize[] = ['xs', 'sm', 'md', 'lg'];

function Buttons() {
  const [busy, setBusy] = useState(false);
  return (
    <div className={s.stack}>
      <Sub>Variants</Sub>
      <div className={s.row}>
        {VARIANTS.map((v) => <Button key={v} variant={v}>{v[0].toUpperCase() + v.slice(1)}</Button>)}
      </div>
      <Sub>Sizes · xs sm md lg</Sub>
      <div className={s.row}>
        {SIZES.map((z) => <Button key={z} size={z} variant="primary" icon="play">Run</Button>)}
        {SIZES.map((z) => <Button key={`i${z}`} size={z} icon="settings" aria-label={`Settings (${z})`} />)}
      </div>
      <Sub>Icon, iconRight, kbd, loading, disabled</Sub>
      <div className={s.row}>
        <Button icon="send" variant="primary" kbd="⌘↵">Submit</Button>
        <Button iconRight="arrow-right">Next lesson</Button>
        <Button
          variant="default"
          icon="play"
          loading={busy}
          onClick={() => {
            setBusy(true);
            window.setTimeout(() => setBusy(false), 1600);
          }}
        >
          {busy ? 'Running…' : 'Click to load'}
        </Button>
        <Button loading variant="primary">Saving</Button>
        <Button disabled icon="lock">Locked</Button>
      </div>
      <Sub>Link variant (next/link) and full width</Sub>
      <div className={s.row}>
        <ButtonLink href="/problems" variant="primary" icon="list">Problems</ButtonLink>
        <ButtonLink href="/learn" variant="ghost" iconRight="external">Learn</ButtonLink>
      </div>
      <Button full variant="outline" icon="github">Continue with GitHub</Button>
    </div>
  );
}

const TONES: PillTone[] = ['default', 'accent', 'ok', 'warn', 'err', 'info', 'muted'];

function Pills() {
  return (
    <div className={s.stack}>
      <Sub>Tones · sm</Sub>
      <div className={s.row}>{TONES.map((t) => <Pill key={t} tone={t}>{t}</Pill>)}</div>
      <Sub>xs · with icon · with dot · md</Sub>
      <div className={s.row}>
        {TONES.map((t) => <Pill key={t} tone={t} size="xs">{t}</Pill>)}
      </div>
      <div className={s.row}>
        <Pill tone="accent" icon="sparkle">New</Pill>
        <Pill tone="ok" dot>Unlocked</Pill>
        <Pill tone="warn" icon="clock">Cooldown 12h</Pill>
        <Pill tone="info" icon="coin" size="md">3 Recursion tokens</Pill>
      </div>
      <Sub>StatusPill · every verdict (code, long, icon)</Sub>
      <div className={s.row}>{VERDICTS.map((v) => <StatusPill key={v} code={v} />)}</div>
      <div className={s.row}>{VERDICTS.map((v) => <StatusPill key={v} code={v} showLong withIcon />)}</div>
      <div className={s.row}>
        <StatusPill code="PND" withIcon label="Compiling" />
        <StatusPill code="OK" size="md" showLong withIcon />
        <StatusPill code="TLE" size="xs" />
      </div>
      <Sub>DifficultyPill</Sub>
      <div className={s.row}>
        <DifficultyPill level="Easy" />
        <DifficultyPill level="Medium" />
        <DifficultyPill level="Hard" />
      </div>
    </div>
  );
}

function Chips() {
  const [on, setOn] = useState<Record<string, boolean>>({ Easy: true, Medium: false, Hard: false });
  const [active, setActive] = useState(['arrays', 'two-pointers', 'Google']);
  return (
    <div className={s.stack}>
      <Sub>Toggle filters (aria-pressed) with counts</Sub>
      <div className={s.row}>
        {(['Easy', 'Medium', 'Hard'] as const).map((d, i) => (
          <Chip key={d} selected={on[d]} onToggle={(v) => setOn((o) => ({ ...o, [d]: v }))} count={[12, 14, 4][i]}>
            {d}
          </Chip>
        ))}
        <Chip icon="lock" disabled onToggle={() => undefined}>Locked</Chip>
      </div>
      <Sub>Removable (active filters)</Sub>
      <div className={s.row}>
        {active.map((f) => (
          <Chip key={f} selected removable onRemove={() => setActive((a) => a.filter((x) => x !== f))}>{f}</Chip>
        ))}
        {active.length === 0 && (
          <Button size="xs" variant="ghost" icon="refresh" onClick={() => setActive(['arrays', 'two-pointers', 'Google'])}>
            Restore filters
          </Button>
        )}
      </div>
      <Sub>Static · small</Sub>
      <div className={s.row}>
        <Chip>hash-map</Chip>
        <Chip size="sm" icon="hash">graphs</Chip>
        <Chip size="sm" count={3}>dp</Chip>
      </div>
    </div>
  );
}

function Inputs() {
  const [q, setQ] = useState('');
  const [handle, setHandle] = useState('ada_l');
  const [lang, setLang] = useState('python');
  return (
    <div className={s.grid2}>
      <Input icon="search" placeholder="Search problems" aria-label="Search problems" kbd="⌘K" value={q} onChange={(e) => setQ(e.target.value)} full />
      <Input label="Email" type="email" placeholder="you@example.com" hint="We never show it publicly." full />
      <Input
        label="Handle"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        error={/^[a-z0-9_]{3,24}$/.test(handle) ? undefined : 'Use 3–24 lowercase letters, digits or _.'}
        hint="Lowercase, 3–24 chars."
        full
        required
      />
      <Input label="Disabled" value="read only" disabled full readOnly />
      <Select
        label="Language"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        options={(Object.keys(LANGUAGE_LABEL) as CodeLanguage[]).map((k) => ({ value: k, label: LANGUAGE_LABEL[k] }))}
        full
      />
      <Select label="Difficulty" placeholder="Any difficulty" defaultValue="" options={['Easy', 'Medium', 'Hard']} error="Pick one to continue." full />
      <div style={{ gridColumn: '1 / -1' }}>
        <Textarea label="Custom input" mono rows={3} defaultValue={'4\n2 7 11 15\n9'} hint="One value per line, passed as stdin." />
      </div>
    </div>
  );
}

function TabsAndToggle({ theme }: { theme: Theme }) {
  const [tab, setTab] = useState('description');
  const [view, setView] = useState('list');
  const [hints, setHints] = useState(true);
  const [ai, setAi] = useState(false);
  const tabsId = `${theme}-demo-tabs`;
  return (
    <div className={s.stack}>
      <Sub>Underline tabs — ←/→ Home End, linked panels</Sub>
      <Tabs
        id={tabsId}
        aria-label="Problem sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'description', label: 'Description', icon: 'book' },
          { value: 'editorial', label: 'Editorial' },
          { value: 'submissions', label: 'Submissions', count: 12 },
          { value: 'discussion', label: 'Discussion', disabled: true },
        ]}
      />
      <TabPanel tabsId={tabsId} value={tab} style={{ padding: '10px 2px', fontSize: 13, color: 'var(--fg-1)' }}>
        Panel for <span className="mono">{tab}</span>. Focus the tab list and use the arrow keys.
      </TabPanel>
      <Sub>Pills tabs · sm</Sub>
      <Tabs variant="pills" size="sm" aria-label="View" value={view} onChange={setView} tabs={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }, { value: 'map', label: 'Map' }]} />
      <Sub>Toggle</Sub>
      <Toggle checked={hints} onChange={setHints} label="Show hint costs" description="Display the token cost before a hint is revealed." />
      <div className={s.row}>
        <Toggle checked={ai} onChange={setAi} aria-label="AI review" size="sm" />
        <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>bare switch (aria-label) · {ai ? 'on' : 'off'}</span>
        <Toggle checked disabled onChange={() => undefined} label="Disabled" />
      </div>
    </div>
  );
}

function Overlays() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { toast } = useToast();
  return (
    <div className={s.stack}>
      <Sub>Tooltip — hover or focus (Esc hides)</Sub>
      <div className={s.row}>
        <Tooltip content="Copy the solution to your clipboard">
          <Button size="sm" icon="copy" aria-label="Copy" />
        </Tooltip>
        <Tooltip content="Settings" side="bottom">
          <Button size="sm" variant="ghost" icon="settings" aria-label="Open settings" />
        </Tooltip>
        <Tooltip content="Runs visible tests only; Submit runs hidden tests too.">
          <Button size="sm" variant="default" icon="play">Run</Button>
        </Tooltip>
      </div>
      <Sub>Modal — focus trap, Esc, focus returns</Sub>
      <div className={s.row}>
        <Button icon="edit" onClick={() => setOpen(true)}>Rename draft…</Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>Delete draft…</Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Rename draft"
        description="Titles show in the catalog and on your profile."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                toast({ title: 'Draft renamed', tone: 'ok' });
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className={s.stack}>
          <Input label="Title" defaultValue="Two Sum — hash map" full />
          <Select label="Difficulty" defaultValue="Easy" options={['Easy', 'Medium', 'Hard']} full />
        </div>
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        role="alertdialog"
        size="sm"
        title="Delete this draft?"
        description="Its tests and hints are deleted too. This can’t be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Keep draft</Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() => {
                setConfirm(false);
                toast({ title: 'Draft deleted', tone: 'err', description: 'Undo is available for 10 seconds.', action: { label: 'Undo', onClick: () => toast('Restored') } });
              }}
            >
              Delete
            </Button>
          </>
        }
      />
      <Sub>Toast — aria-live, pauses on hover/focus</Sub>
      <div className={s.row}>
        <Button size="sm" onClick={() => toast('Draft saved')}>Default</Button>
        <Button size="sm" variant="success" onClick={() => toast({ title: 'Accepted', description: 'Beats 87% of Python submissions.', tone: 'ok' })}>Success</Button>
        <Button size="sm" onClick={() => toast({ title: 'Cooldown active', description: 'Next gate attempt in 11 h 42 m.', tone: 'warn' })}>Warning</Button>
        <Button size="sm" variant="danger" onClick={() => toast({ title: 'Run failed', description: 'The judge is unreachable. Try again shortly.', tone: 'err', action: { label: 'Retry', onClick: () => toast('Retrying…') } })}>Error</Button>
        <Button size="sm" onClick={() => toast({ title: 'Recursion unlocked', description: 'Spent 2 Easy tokens.', tone: 'info' })}>Info</Button>
      </div>
    </div>
  );
}

function Progress() {
  return (
    <div className={s.stack}>
      <Sub>Skeleton</Sub>
      <div className={s.row} style={{ alignItems: 'flex-start', gap: 14 }}>
        <Skeleton circle height={36} />
        <div style={{ flex: 1, minWidth: 160 }}>
          <Skeleton width="40%" height={14} style={{ marginBottom: 10 }} />
          <SkeletonText lines={3} />
        </div>
        <Skeleton width={96} height={64} radius={8} />
      </div>
      <Sub>ProgressBar</Sub>
      <ProgressBar label="Arrays track" value={7} max={12} valueText="7 of 12 lessons" showValue />
      <div className={s.grid2}>
        <ProgressBar aria-label="Accepted share" value={82} tone="ok" height={6} showValue label="Accepted" />
        <ProgressBar aria-label="Memory" value={64} tone="warn" height={6} showValue label="Memory" />
        <ProgressBar aria-label="Failures" value={23} tone="err" height={6} showValue label="Failures" />
        <ProgressBar aria-label="Queue" indeterminate tone="info" label="Judging…" />
      </div>
    </div>
  );
}

function KbdAndBreadcrumb({ theme }: { theme: Theme }) {
  return (
    <div className={s.stack}>
      <div className={s.row} style={{ fontSize: 13, color: 'var(--fg-1)' }}>
        <Kbd bare>⌘K</Kbd> jump · <Kbd bare>⌘↵</Kbd> run · <Kbd bare>Esc</Kbd> close · <Kbd bare>Shift</Kbd>+<Kbd bare>Tab</Kbd> back
      </div>
      <Breadcrumb label={`Breadcrumb example 1 (${theme})`} items={[{ label: 'Learn', href: '/learn', icon: 'graduation' }, { label: 'Arrays & Hashing', href: '/learn/arrays' }, { label: 'Two pointers on sorted input' }]} />
      <Breadcrumb label={`Breadcrumb example 2 (${theme})`} items={[{ label: 'Problems', href: '/problems' }, { label: 'Longest Substring Without Repeating Characters, a much longer title' }]} />
    </div>
  );
}

/* ── Code ───────────────────────────────────────────────────────── */

const SNIPPETS: Record<CodeLanguage, [string, string]> = {
  python: ['two_sum.py', 'def two_sum(nums: list[int], target: int) -> list[int]:\n    seen = {}  # value -> index\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n    return []\n'],
  javascript: ['twoSum.js', 'function twoSum(nums, target) {\n  const seen = new Map(); // value -> index\n  for (let i = 0; i < nums.length; i++) {\n    const need = target - nums[i];\n    if (seen.has(need)) return [seen.get(need), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n'],
  typescript: ['twoSum.ts', 'export function twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (const [i, x] of nums.entries()) {\n    const j = seen.get(target - x);\n    if (j !== undefined) return [j, i];\n    seen.set(x, i);\n  }\n  return [];\n}\n'],
  cpp: ['two_sum.cpp', '#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < (int)nums.size(); ++i) {\n        auto it = seen.find(target - nums[i]);\n        if (it != seen.end()) return {it->second, i};\n        seen[nums[i]] = i;\n    }\n    return {};\n}\n'],
  java: ['Solution.java', 'import java.util.HashMap;\n\nclass Solution {\n    public int[] twoSum(int[] nums, int target) {\n        HashMap<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            Integer j = seen.get(target - nums[i]);\n            if (j != null) return new int[]{j, i};\n            seen.put(nums[i], i);\n        }\n        return new int[0];\n    }\n}\n'],
  go: ['two_sum.go', 'func twoSum(nums []int, target int) []int {\n\tseen := map[int]int{} // value -> index\n\tfor i, x := range nums {\n\t\tif j, ok := seen[target-x]; ok {\n\t\t\treturn []int{j, i}\n\t\t}\n\t\tseen[x] = i\n\t}\n\treturn nil\n}\n'],
};

const RUN_DEMO = 'import sys\n\n# Sum every integer on stdin.\nnums = [int(t) for t in sys.stdin.read().split()]\nprint(f"sum = {sum(nums)} over {len(nums)} values")\n';

/** Fake judge for the showcase: parses stdin, fakes timings, simulates CE/RE. */
const mockRun: RunCode = async (code, stdin) => {
  await new Promise((r) => setTimeout(r, 700));
  const opens = (code.match(/\(/g) ?? []).length;
  const closes = (code.match(/\)/g) ?? []).length;
  if (opens !== closes) {
    return { status: 'CE', error: `  File "main.py", line 1\nSyntaxError: '(' was never closed`, compileMs: 18 };
  }
  if (/\braise\b/.test(code)) {
    return { status: 'RE', stderr: 'Traceback (most recent call last):\n  File "main.py", line 4, in <module>\nValueError: boom', runtimeMs: 2.41, memoryKb: 9180 };
  }
  const nums = stdin.split(/\s+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
  return {
    status: 'OK',
    stdout: `sum = ${nums.reduce((a, b) => a + b, 0)} over ${nums.length} values`,
    runtimeMs: 0.6 + Math.random() * 0.8,
    memoryKb: 9216 + Math.round(Math.random() * 400),
  };
};

function Code() {
  const [lang, setLang] = useState<CodeLanguage>('python');
  const [file, src] = SNIPPETS[lang];
  return (
    <div className={s.stack}>
      <Sub>CodeBlock — six languages, filename, badge, copy, highlighted lines</Sub>
      <Tabs
        variant="pills"
        size="sm"
        aria-label="Snippet language"
        value={lang}
        onChange={(v) => setLang(v as CodeLanguage)}
        tabs={(Object.keys(SNIPPETS) as CodeLanguage[]).map((k) => ({ value: k, label: LANGUAGE_LABEL[k] }))}
      />
      <CodeBlock code={src} language={lang} filename={file} copy highlightLines={lang === 'python' ? [4, 5] : undefined} />
      <Sub>RunnableCodeBlock — mock run(code, stdin); add “raise” for RE or drop a “)” for CE</Sub>
      <RunnableCodeBlock code={RUN_DEMO} language="python" filename="sum.py" stdin={'3 4 5\n10'} run={mockRun} />
    </div>
  );
}

function Callouts() {
  return (
    <div className={s.stack}>
      <Callout kind="complexity" time="O(n)" space="O(n)">One pass; each lookup in the hash map is O(1) on average.</Callout>
      <Callout kind="pitfall">Don’t return the same index twice — check the map <em>before</em> inserting the current value.</Callout>
      <Callout kind="note" title="Why a hash map?">Sorting would cost O(n log n) and lose the original indices.</Callout>
      <Formula tex={'T(n) = T\\left(\\frac{n}{2}\\right) + O(1) \\implies T(n) = O(\\log n)'} label="(1)" />
      <Formula tex={'\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}, \\qquad \\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!}'} />
      <Formula
        tex={'f(n) = \\begin{cases} 1 & n \\le 1 \\\\ f(n-1) + f(n-2) & n > 1 \\end{cases}'}
        caption="Fibonacci as a recurrence (MathML, no KaTeX)."
      />
      <Formula tex={'\\text{mid} = \\left\\lfloor \\frac{lo + hi}{2} \\right\\rfloor, \\quad lo \\le mid \\le hi'} />
    </div>
  );
}

const NEW_ICONS = new Set(['map', 'route', 'book-open', 'award', 'coin', 'sun', 'moon', 'log-out', 'git-branch', 'grid', 'edit', 'trash', 'sort', 'repeat', 'shield', 'puzzle', 'network', 'table', 'window', 'arrows-lr']);

function Icons() {
  return (
    <div>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--fg-2)' }}>
        {ICON_NAMES.length} icons. Outlined in accent: added by the UI kit. Content JSON may only use these names.
      </p>
      <div className={s.icons}>
        {ICON_NAMES.map((n) => (
          <div key={n} className={`${s.iconCell} ${NEW_ICONS.has(n) ? s.iconNew : ''}`}>
            <Icon name={n} size={18} />
            <span className="mono">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function States() {
  return (
    <div className={s.stack}>
      <Sub>EmptyState</Sub>
      <div className={s.stateBox}>
        <EmptyState
          icon="search"
          headingLevel={4}
          title="No problems match these filters"
          description="Try removing a tag or switching the status filter to All."
          action={<Button size="sm" icon="refresh">Clear filters</Button>}
        />
      </div>
      <Sub>LoadingState · list page</Sub>
      <div className={`${s.stateBox} ${s.stateScroll}`}><ListPageSkeleton rows={5} /></div>
      <Sub>LoadingState · editor</Sub>
      <div className={`${s.stateBox} ${s.stateScroll}`}><EditorSkeleton /></div>
      <Sub>NotFound (404)</Sub>
      <div className={s.stateBox}><NotFound embedded /></div>
      <Sub>ServerError (500)</Sub>
      <div className={s.stateBox}><ServerError embedded digest="3481920557" onRetry={() => undefined} /></div>
    </div>
  );
}

/** Every UI-kit component, for one theme. Rendered twice by the page. */
export function SystemSheet({ theme }: { theme: Theme }) {
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope} className={s.sheet}>
      <Section theme={theme} id="colors" title="Color tokens" note="computed in this theme"><Colors scope={scope} /></Section>
      <Section theme={theme} id="contrast" title="Contrast" note="WCAG, measured live"><Contrast scope={scope} /></Section>
      <Section theme={theme} id="type" title="Type scale" note="Inter · JetBrains Mono"><TypeScale /></Section>
      <Section theme={theme} id="radii" title="Radii & shadows"><Radii /></Section>
      <Section theme={theme} id="buttons" title="Buttons"><Buttons /></Section>
      <Section theme={theme} id="pills" title="Pills & status pills"><Pills /></Section>
      <Section theme={theme} id="chips" title="Chips"><Chips /></Section>
      <Section theme={theme} id="inputs" title="Inputs & select"><Inputs /></Section>
      <Section theme={theme} id="tabs" title="Tabs & toggle"><TabsAndToggle theme={theme} /></Section>
      <Section theme={theme} id="overlays" title="Tooltip · modal · toast"><Overlays /></Section>
      <Section theme={theme} id="progress" title="Skeleton & progress"><Progress /></Section>
      <Section theme={theme} id="kbd" title="Kbd & breadcrumb"><KbdAndBreadcrumb theme={theme} /></Section>
      <Section theme={theme} id="code" title="Code blocks"><Code /></Section>
      <Section theme={theme} id="callouts" title="Callouts & formula"><Callouts /></Section>
      <Section theme={theme} id="viz" title="VisualizationFrame" note="binary search"><BinarySearchViz /></Section>
      <Section theme={theme} id="icons" title="Icons"><Icons /></Section>
      <Section theme={theme} id="states" title="States"><States /></Section>
    </div>
  );
}
