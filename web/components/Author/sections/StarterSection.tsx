'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { LangMark } from '@/components/ui/LangMark';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';
import { CodeField } from '../CodeField';
import { ProblemList, Section, type SectionProps } from '../kit';
import { draftSignature, generateStub, IDENTIFIER_RE, LANGUAGE_NAMES } from '../model';
import s from '../author.module.css';

interface Props extends SectionProps {
  /** Languages whose starter differs from the generated stub. */
  edited: Record<SupportedLanguage, boolean>;
  onEdit: (lang: SupportedLanguage, code: string) => void;
  onRegenerate: (langs: SupportedLanguage[]) => void;
}

export function StarterSection({ draft, checks, edited, onEdit, onRegenerate }: Props) {
  const [lang, setLang] = useState<SupportedLanguage>('python');
  const [confirm, setConfirm] = useState<SupportedLanguage[] | null>(null);
  const tabsId = useId();
  const canGenerate = IDENTIFIER_RE.test(draft.functionName);
  const editedLangs = LANGUAGES.filter((l) => edited[l] && draft.starterCode[l].trim());

  const regenerate = (langs: SupportedLanguage[]) => {
    const touched = langs.filter((l) => edited[l] && draft.starterCode[l].trim());
    if (touched.length) setConfirm(langs);
    else onRegenerate(langs);
  };

  return (
    <Section
      id="starter"
      n={5}
      title="Starter code"
      desc="Generated from the signature and kept in sync until you edit a language. Every stub must compile as is."
      done={checks.starter.ok}
      tools={
        <Button size="sm" icon="refresh" disabled={!canGenerate} onClick={() => regenerate([...LANGUAGES])}>
          Regenerate all
        </Button>
      }
    >
      <Tabs
        id={tabsId}
        aria-label="Starter code language"
        value={lang}
        onChange={(v) => setLang(v as SupportedLanguage)}
        tabs={LANGUAGES.map((l) => ({
          value: l,
          label: LANGUAGE_NAMES[l],
          icon: draft.starterCode[l].trim() ? undefined : 'alert-circle',
        }))}
      />
      <div role="tabpanel" id={tabPanelId(tabsId, lang)} aria-labelledby={tabId(tabsId, lang)}>
        <CodeField
          value={draft.starterCode[lang]}
          onChange={(code) => onEdit(lang, code)}
          language={lang}
          label={`${LANGUAGE_NAMES[lang]} starter code`}
          minLines={8}
          placeholder={canGenerate ? '' : 'Set a function name in Signature to generate this stub'}
          header={
            <>
              <LangMark lang={lang} size={13} />
              <span className={s.codeHeadTitle}>{LANGUAGE_NAMES[lang]}</span>
              {draft.starterCode[lang].trim() ? (
                edited[lang] ? (
                  <Pill tone="warn" size="xs">edited</Pill>
                ) : (
                  <Pill tone="muted" size="xs">generated</Pill>
                )
              ) : (
                <Pill tone="err" size="xs">empty</Pill>
              )}
              <span style={{ flex: 1 }} />
              <Button
                variant="ghost"
                size="xs"
                icon="refresh"
                disabled={!canGenerate}
                onClick={() => regenerate([lang])}
                title={canGenerate ? undefined : 'Set a valid function name first'}
              >
                Regenerate
              </Button>
            </>
          }
        />
      </div>
      <p className={s.help}>
        {lang === 'go'
          ? 'Go stubs have no package clause and no imports — the harness adds them.'
          : lang === 'java'
            ? 'Java stubs declare a static method inside class Solution.'
            : lang === 'cpp'
              ? 'C++ stubs include their own headers and using namespace std;.'
              : lang === 'typescript'
                ? 'TypeScript stubs are typed function declarations that return a zero value.'
                : 'Keep the function name and parameter names identical to the signature.'}
      </p>
      <ProblemList problems={checks.starter.problems} />

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        role="alertdialog"
        size="sm"
        title="Replace edited starter code?"
        description={`Your edits to ${editedLangs.filter((l) => confirm?.includes(l)).map((l) => LANGUAGE_NAMES[l]).join(', ')} will be replaced by the stub generated from the signature.`}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep my edits</Button>
            <Button
              variant="danger"
              icon="refresh"
              onClick={() => {
                if (confirm) onRegenerate(confirm);
                setConfirm(null);
              }}
            >
              Replace
            </Button>
          </>
        }
      />
    </Section>
  );
}

/** Generated stubs for `langs` (callers keep languages the author edited). */
export function regenerated(draft: SectionProps['draft'], langs: SupportedLanguage[]) {
  const sig = draftSignature(draft);
  return Object.fromEntries(langs.map((l) => [l, generateStub(l, draft.functionName, sig)])) as Partial<
    Record<SupportedLanguage, string>
  >;
}
