import { useEditor } from '../../context/EditorContext';
import type { Language } from '../../types/execution';
import { LangMark } from '../ui/primitives';
import { Icon } from '../ui/Icon';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
];

export function LanguageSelector() {
  const { selectedLanguage, setSelectedLanguage } = useEditor();
  const current = LANGUAGES.find((l) => l.value === selectedLanguage);

  return (
    <label
      className="focus-ring"
      style={{
        height: 32,
        padding: '0 10px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r)',
        color: 'var(--fg-0)',
        fontSize: 13,
        fontFamily: 'var(--font-sans)',
        cursor: 'pointer',
      }}
    >
      <LangMark lang={current?.label ?? 'Python'} size={14} />
      <select
        value={selectedLanguage}
        onChange={(e) => setSelectedLanguage(e.target.value as Language)}
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--fg-0)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
          appearance: 'none',
          WebkitAppearance: 'none',
          paddingRight: 14,
          cursor: 'pointer',
        }}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.value} value={lang.value} style={{ background: 'var(--bg-2)' }}>
            {lang.label}
          </option>
        ))}
      </select>
      <Icon name="chev-down" size={13} style={{ color: 'var(--fg-3)', marginLeft: -10, pointerEvents: 'none' }} />
    </label>
  );
}
