'use client';

import { useDeferredValue, useId, useState } from 'react';
import { Textarea } from '@/components/ui/Input';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { Markdown } from '@/components/Library/Markdown';
import s from './author.module.css';

export interface MarkdownFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  /** split: editor and live preview side by side · tabs: Write / Preview. */
  layout?: 'split' | 'tabs';
  /** Heading offset for the preview (matches where the text renders for learners). */
  headingOffset?: number;
}

/**
 * Markdown source + live preview, rendered through the same sanitized
 * pipeline learners see (react-markdown + remark-gfm + rehype-sanitize).
 * The preview trails typing via useDeferredValue so long statements stay
 * responsive; its links open in a new tab so nothing navigates away from
 * unsaved work.
 */
export function MarkdownField({
  label, value, onChange, hint, error, placeholder, rows = 10, required, layout = 'split', headingOffset = 1,
}: MarkdownFieldProps) {
  const deferred = useDeferredValue(value);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const tabsId = useId();
  const previewId = useId();

  const editor = (
    <Textarea
      label={layout === 'split' ? label : undefined}
      aria-label={layout === 'tabs' ? label : undefined}
      hint={hint}
      error={error ?? undefined}
      required={required}
      mono
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      textareaStyle={{ minHeight: rows * 19 }}
    />
  );
  const preview = (
    <div id={previewId} className={`${s.mdPreview} scroll`} aria-label={`${label} preview`} role="region" tabIndex={0}>
      {deferred.trim() ? (
        <Markdown headingOffset={headingOffset} newTabLinks size="sm">
          {deferred}
        </Markdown>
      ) : (
        <span className={s.mdEmpty}>Nothing to preview yet.</span>
      )}
    </div>
  );

  if (layout === 'tabs') {
    return (
      <div className={s.mdPane}>
        <div className={s.mdPaneHead}>
          <span className={s.label}>{label}</span>
          <Tabs
            id={tabsId}
            variant="pills"
            size="sm"
            aria-label={`${label}: write or preview`}
            value={tab}
            onChange={(v) => setTab(v as 'write' | 'preview')}
            tabs={[
              { value: 'write', label: 'Write', icon: 'edit' },
              { value: 'preview', label: 'Preview', icon: 'eye' },
            ]}
            style={{ marginLeft: 'auto' }}
          />
        </div>
        {/* Own panel element: the kit's TabPanel adds a tab stop, and this panel's content is focusable already. */}
        <div role="tabpanel" id={tabPanelId(tabsId, tab)} aria-labelledby={tabId(tabsId, tab)}>
          {tab === 'write' ? editor : preview}
        </div>
      </div>
    );
  }

  return (
    <div className={s.md}>
      <div className={s.mdPane}>{editor}</div>
      <div className={s.mdPane}>
        <div className={s.mdPaneHead}>
          <span className={s.label}>Preview</span>
          <span className={s.help} style={{ marginLeft: 'auto' }}>as learners see it</span>
        </div>
        {preview}
      </div>
    </div>
  );
}
