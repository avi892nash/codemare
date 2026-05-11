'use client';

import { useState } from 'react';
import { DSSection } from '../DSSection';
import { Input } from '../../ui/Input';
import { Tabs } from '../../ui/Tabs';
import { Switch } from '../../ui/Switch';
import { LangMark } from '../../ui/LangMark';
import { Icon } from '../../ui/Icon';

export function FormControlsSection() {
  const [tab, setTab]   = useState('Description');
  const [pill, setPill] = useState('Visible');
  const [auto, setAuto] = useState(true);

  return (
    <DSSection kicker="08 — Form controls" title="Inputs, selects, switch" span={5}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input icon="search" placeholder="Search problems" kbd="⌘K" />
        <SelectMock value="Python 3.12" lang="Python" />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tabs tabs={['Description', 'Editorial', 'Discussion', 'Submissions']} value={tab} onChange={setTab} />
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tabs variant="pills" tabs={['Visible', 'Custom', 'Hidden']} value={pill} onChange={setPill} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>Auto-run</span>
        <Switch checked={auto} onChange={setAuto} />
      </div>
    </DSSection>
  );
}

/* The design's Select is a display-only mock; real selects use the LanguageSelector
 * in the workspace. Inlined here so the section is self-contained. */
function SelectMock({ value, lang }: { value: string; lang: string }) {
  return (
    <span
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
      }}
    >
      <LangMark lang={lang} />
      <span>{value}</span>
      <Icon name="chev-down" size={13} style={{ color: 'var(--fg-3)', marginLeft: 4 }} />
    </span>
  );
}
