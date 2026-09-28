'use client';

import { useId, useState, type ReactNode } from 'react';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import s from './library.module.css';

export interface LanguagePanel {
  value: string;
  label: string;
  /** Shown beside the tabs for the selected language (version, date, submission). */
  note: ReactNode;
  /** The code, highlighted on the server. */
  code: ReactNode;
}

/** A component's latest passing code, one tab per language it was built in. */
export function LanguageTabs({ panels, label }: { panels: LanguagePanel[]; label: string }) {
  const id = useId();
  const [tab, setTab] = useState(panels[0]?.value ?? '');
  if (panels.length === 0) return null;
  if (panels.length === 1) {
    return (
      <div className={s.codeCol}>
        <div className={s.codeHead}>
          <span className={s.label} style={{ margin: 0 }}>
            {panels[0].label}
          </span>
          {panels[0].note}
        </div>
        {panels[0].code}
      </div>
    );
  }
  return (
    <div className={s.codeCol}>
      <div className={s.codeHead}>
        <Tabs id={id} tabs={panels.map((p) => ({ value: p.value, label: p.label }))} value={tab} onChange={setTab} variant="pills" size="sm" aria-label={label} />
        {panels.find((p) => p.value === tab)?.note}
      </div>
      {panels.map((p) => (
        <div key={p.value} hidden={p.value !== tab}>
          <TabPanel tabsId={id} value={p.value}>
            {p.code}
          </TabPanel>
        </div>
      ))}
    </div>
  );
}
