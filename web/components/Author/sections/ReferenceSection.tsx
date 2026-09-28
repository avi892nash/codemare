'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LangMark } from '@/components/ui/LangMark';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { StatusPill } from '@/components/ui/StatusPill';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { fmtTime } from '@/components/ui/formatters';
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';
import { CodeField } from '../CodeField';
import { ProblemList, Section, type SectionProps } from '../kit';
import {
  fillableTests,
  formatJson,
  LANGUAGE_NAMES,
  providedReferences,
  referenceFingerprint,
  runOutcome,
  type ReferenceRun,
} from '../model';
import s from '../author.module.css';

interface Props extends SectionProps {
  runs: Partial<Record<SupportedLanguage, ReferenceRun>>;
  /** The language running now ('all' while running every reference). */
  running: SupportedLanguage | 'all' | null;
  onRun: (lang: SupportedLanguage) => void;
  onRunAll: () => void;
  onFillAll: (lang: SupportedLanguage) => void;
}

const truncate = (text: string, n = 120) => (text.length > n ? `${text.slice(0, n)}…` : text);

export function ReferenceSection({ draft, update, checks, runs, running, onRun, onRunAll, onFillAll }: Props) {
  const [lang, setLang] = useState<SupportedLanguage>('python');
  const [confirmFill, setConfirmFill] = useState(false);
  const tabsId = useId();
  const provided = providedReferences(draft);
  const run = runs[lang] ?? null;
  const fresh = run ? run.fingerprint === referenceFingerprint(draft, lang) : false;
  const fillable = run && fresh ? fillableTests(run) : [];
  const outcome = run ? runOutcome(run) : null;
  const code = draft.referenceSolutions[lang];
  const busy = running !== null;

  return (
    <Section
      id="reference"
      n={7}
      title="Reference solutions"
      desc="Never shown to learners. Python is required; every solution you add must pass every test before you can publish."
      done={checks.reference.ok}
      tools={
        <Button size="sm" icon="play" disabled={provided.length === 0 || busy} loading={running === 'all'} onClick={onRunAll}>
          Run all ({provided.length})
        </Button>
      }
    >
      <Tabs
        id={tabsId}
        aria-label="Reference solution language"
        value={lang}
        onChange={(v) => setLang(v as SupportedLanguage)}
        tabs={LANGUAGES.map((l) => {
          const r = runs[l];
          const ok = r && r.status === 'OK' && r.fingerprint === referenceFingerprint(draft, l);
          return {
            value: l,
            label: l === 'python' ? `${LANGUAGE_NAMES[l]} *` : LANGUAGE_NAMES[l],
            icon: draft.referenceSolutions[l].trim() ? (ok ? 'check-circle' : 'circle') : undefined,
          };
        })}
      />
      <div role="tabpanel" id={tabPanelId(tabsId, lang)} aria-labelledby={tabId(tabsId, lang)} className={s.fieldset} style={{ gap: 12 }}>
        <CodeField
          value={code}
          onChange={(v) => update((d) => ({ ...d, referenceSolutions: { ...d.referenceSolutions, [lang]: v } }))}
          language={lang}
          label={`${LANGUAGE_NAMES[lang]} reference solution`}
          minLines={10}
          placeholder={
            lang === 'python'
              ? 'Required. A correct, reasonably efficient solution.'
              : `Optional. Paste a ${LANGUAGE_NAMES[lang]} solution to verify the tests in this language too.`
          }
          header={
            <>
              <LangMark lang={lang} size={13} />
              <span className={s.codeHeadTitle}>{LANGUAGE_NAMES[lang]}</span>
              {lang === 'python' ? <Pill tone="accent" size="xs">required</Pill> : <Pill tone="muted" size="xs">optional</Pill>}
              <span style={{ flex: 1 }} />
              <Button
                variant="primary"
                size="sm"
                icon="play"
                disabled={!code.trim() || (busy && running !== lang)}
                loading={running === lang}
                onClick={() => onRun(lang)}
              >
                Run reference against tests
              </Button>
            </>
          }
        />

        {run && (
          <div className={s.fieldset} style={{ gap: 10 }} aria-live="polite">
            <div className={s.runBar}>
              {outcome?.onlyMissing ? (
                <Pill tone="info" icon="info" size="sm">
                  Ran — {outcome.missing} expected output{outcome.missing === 1 ? '' : 's'} to fill
                </Pill>
              ) : (
                <StatusPill code={run.status} showLong withIcon size="sm" />
              )}
              <span className={s.runMetric}>
                {run.totalPassed}/{run.totalTests} passed
              </span>
              {run.compileMs != null && (
                <span className={s.runMetric} title="Compile time">
                  <Icon name="cpu" size={12} />
                  {fmtTime(run.compileMs).join(' ')}
                </span>
              )}
              {run.tests.length > 0 && (
                <span className={s.runMetric} title="Total CPU time">
                  <Icon name="zap" size={12} />
                  {fmtTime(run.tests.reduce((n, t) => n + t.runUs, 0) / 1000).join(' ')}
                </span>
              )}
              {!fresh && (
                <Pill tone="warn" size="xs" icon="refresh">
                  stale — code or tests changed
                </Pill>
              )}
              {fresh && fillable.length > 0 && (
                <Button size="sm" variant="accent" icon="check" style={{ marginLeft: 'auto' }} onClick={() => setConfirmFill(true)}>
                  Fill {fillable.length} expected output{fillable.length === 1 ? '' : 's'} from actual
                </Button>
              )}
            </div>
            {run.error && <pre className={`${s.errorPre} scroll`}>{run.error}</pre>}
            {run.tests.length > 0 && (
              <div className={`${s.resultsWrap} scroll`} tabIndex={0} role="region" aria-label={`${LANGUAGE_NAMES[lang]} results per test`}>
                <table className={s.results}>
                  <thead>
                    <tr>
                      <th scope="col">Test</th>
                      <th scope="col">Result</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Actual</th>
                      <th scope="col">CPU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.tests.map((t) => {
                      const test = draft.tests[t.idx];
                      return (
                        <tr key={t.idx}>
                          <td className={s.cellMono}>
                            {t.idx + 1}
                            {t.hidden && (
                              <Icon name="eye-off" size={11} style={{ marginLeft: 6, color: 'var(--fg-3)' }} label="hidden" />
                            )}
                          </td>
                          <td>
                            {t.expectedMissing ? (
                              <Pill tone="muted" size="xs">no expected</Pill>
                            ) : t.passed ? (
                              <Pill tone="ok" size="xs" icon="check">pass</Pill>
                            ) : (
                              <Pill tone="err" size="xs" icon="x">{t.error ? 'error' : 'fail'}</Pill>
                            )}
                          </td>
                          <td>
                            <code>{fresh && test ? truncate(test.expected || '—') : '—'}</code>
                          </td>
                          <td>
                            {t.error ? (
                              <span className={s.errText}>{truncate(t.error, 200)}</span>
                            ) : (
                              <code>{t.hasActual ? truncate(formatJson(t.actual)) : '—'}</code>
                            )}
                          </td>
                          <td className={s.cellMono}>{fmtTime(t.runUs / 1000).join(' ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <ProblemList problems={checks.reference.problems} />

      <Modal
        open={confirmFill}
        onClose={() => setConfirmFill(false)}
        role="alertdialog"
        size="sm"
        title="Fill expected outputs?"
        description={`${fillable.length} test${fillable.length === 1 ? '' : 's'} will expect exactly what the ${LANGUAGE_NAMES[lang]} reference returned. Make sure the reference is correct — the tests will agree with it either way.`}
        footer={
          <>
            <Button onClick={() => setConfirmFill(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon="check"
              onClick={() => {
                onFillAll(lang);
                setConfirmFill(false);
              }}
            >
              Fill {fillable.length}
            </Button>
          </>
        }
      />
    </Section>
  );
}
