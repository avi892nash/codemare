'use client';

import { Select } from '@/components/ui/Select';
import { LANGUAGE_META } from '@/lib/client/languages';
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';

interface LanguageSelectorProps<L extends SupportedLanguage> {
  value: L;
  onChange: (language: L) => void;
  /** The languages on offer (default: all six). */
  languages?: readonly L[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
}

/** The judge-language picker (a native select: keyboard and typeahead for free). */
export function LanguageSelector<L extends SupportedLanguage>({
  value,
  onChange,
  languages,
  size = 'sm',
  disabled,
  id,
}: LanguageSelectorProps<L>) {
  const list = (languages ?? (LANGUAGES as readonly SupportedLanguage[])) as readonly L[];
  return (
    <Select
      id={id}
      size={size}
      icon="code"
      aria-label="Language"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as L)}
      options={list.map((l) => ({ value: l, label: LANGUAGE_META[l].label }))}
      data-testid="language-select"
    />
  );
}
