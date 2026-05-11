import { Button, Input, Logomark, Pill } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import type { Mode } from '../../context/EditorContext';

interface NavbarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

const NAV_ITEMS: Array<{
  name: string;
  mode: Mode | null;
  icon: 'list' | 'graduation' | 'terminal' | 'history' | 'user' | 'sparkle';
}> = [
  { name: 'Problems',      mode: 'problem', icon: 'list' },
  { name: 'Learn',         mode: null,      icon: 'graduation' },
  { name: 'IDE',           mode: 'ide',     icon: 'terminal' },
  { name: 'Submissions',   mode: null,      icon: 'history' },
  { name: 'Design system', mode: 'design',  icon: 'sparkle' },
];

export function Navbar({ mode, onModeChange }: NavbarProps) {
  return (
    <header
      style={{
        height: 48,
        padding: '0 18px',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--bg-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Logomark />
        <span style={{ fontWeight: 600, letterSpacing: -0.2, color: 'var(--fg-0)' }}>codemare</span>
        <Pill tone="muted" size="xs" style={{ fontFamily: 'var(--font-mono)', marginLeft: 6 }}>
          µs-judge
        </Pill>
      </div>

      <nav style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
        {NAV_ITEMS.map((it) => {
          const active = it.mode === mode;
          const disabled = it.mode === null;
          return (
            <button
              key={it.name}
              onClick={() => it.mode && onModeChange(it.mode)}
              disabled={disabled}
              title={disabled ? 'Coming soon' : undefined}
              style={{
                padding: '6px 10px',
                fontSize: 13,
                fontWeight: 500,
                background: active ? 'var(--bg-3)' : 'transparent',
                color: disabled ? 'var(--fg-4)' : active ? 'var(--fg-0)' : 'var(--fg-2)',
                border: 'none',
                borderRadius: 6,
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <Icon name={it.icon} size={13} />
              {it.name}
            </button>
          );
        })}
      </nav>

      <span style={{ flex: 1 }} />

      <Input icon="search" placeholder="Jump to problem…" kbd="⌘K" size="sm" />

      <a
        href="https://github.com/avi892nash/codemare"
        target="_blank"
        rel="noopener noreferrer"
        title="GitHub"
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          color: 'var(--fg-2)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
        }}
      >
        <Icon name="github" size={15} />
      </a>
      <Button
        variant={mode === 'auth' ? 'accent' : 'default'}
        size="sm"
        icon="user"
        onClick={() => onModeChange('auth')}
      >
        Sign in
      </Button>
    </header>
  );
}
