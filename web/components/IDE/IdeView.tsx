'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { CodeEditor, type CodeEditorHandle } from '@/components/Editor/CodeEditor';
import { LanguageSelector } from '@/components/Editor/LanguageSelector';
import { useModKey, useTouchOnly } from '@/components/Workspace/useModKey';
import { runIdeCode } from '@/app/(workspace)/ide/actions';
import { clearDraft, loadDraft, loadLanguage, saveDraft, saveLanguage } from '@/lib/client/drafts';
import { LANGUAGE_META } from '@/lib/client/languages';
import type { IdeExecutionResponse, IdeTestCase, SupportedLanguage } from '@/lib/types';
import { IdeOutputDisplay, runSummary } from './IdeOutputDisplay';
import { TestCaseManager } from './TestCaseManager';
import s from './IDE.module.css';

/** First-run snippets: read two numbers from stdin, print their sum. */
export const IDE_STARTERS: Record<SupportedLanguage, string> = {
  python: `# Read stdin, write stdout. input() reads one line.\na = int(input())\nb = int(input())\nprint(a + b)\n`,
  javascript: `// Read all of stdin, then parse it.\nconst data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(data[0] + data[1]);\n`,
  typescript: `// Read all of stdin, then parse it.\nimport { readFileSync } from 'fs';\n\nconst [a, b]: number[] = readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n`,
  cpp: `#include <iostream>\n\nint main() {\n    long long a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << std::endl;\n    return 0;\n}\n`,
  java: `import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        long a = sc.nextLong();\n        long b = sc.nextLong();\n        System.out.println(a + b);\n    }\n}\n`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int64\n\tfmt.Scan(&a, &b)\n\tfmt.Println(a + b)\n}\n`,
};

const DEFAULT_CASES: IdeTestCase[] = [
  { input: '2\n3', expectedOutput: '5' },
  { input: '-7\n10', expectedOutput: '3' },
];
const SCOPE = 'ide';

/** Below 1024 px one pane shows at a time (the problem page's breakpoint — keep in step with IDE.module.css). */
type PhoneView = 'code' | 'cases' | 'output';
const PHONE_VIEWS = [
  { value: 'code', label: 'Code' },
  { value: 'cases', label: 'Test cases' },
  { value: 'output', label: 'Output' },
];
const isNarrow = () => window.matchMedia('(max-width: 1023px)').matches;

/**
 * /ide — the free playground: any of the six languages, up to ten stdin
 * cases with optional expected output (diffed), runtime and memory per
 * case. Same themed Monaco as the problem editor; drafts per language.
 * Its toolbar is the problem page's: the language and a reset at the left,
 * Run at the right (⌘/Ctrl+Enter, printed on a keyboard device only). Below
 * 1024 px it is the problem page's phone layout too: Code · Test cases ·
 * Output, one pane at a time, and a finished run takes the screen.
 */
export function IdeView() {
  const mod = useModKey();
  const touch = useTouchOnly();
  const [language, setLanguage] = useState<SupportedLanguage>('python');
  const [code, setCode] = useState(IDE_STARTERS.python);
  const [restored, setRestored] = useState(false);
  const [testCases, setTestCases] = useState<IdeTestCase[]>(DEFAULT_CASES);
  const [results, setResults] = useState<IdeExecutionResponse | null>(null);
  const [ranLanguage, setRanLanguage] = useState<SupportedLanguage>('python');
  const [pending, startTransition] = useTransition();
  const editor = useRef<CodeEditorHandle | null>(null);
  const outputPane = useRef<HTMLElement>(null);
  const [view, setView] = useState<PhoneView>('code');

  useEffect(() => {
    const lang = loadLanguage(SCOPE) ?? 'python';
    setLanguage(lang);
    setCode(loadDraft(SCOPE, lang) ?? IDE_STARTERS[lang]);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    const t = window.setTimeout(() => saveDraft(SCOPE, language, code, IDE_STARTERS[language]), 350);
    return () => window.clearTimeout(t);
  }, [code, language, restored]);

  const switchLanguage = (next: SupportedLanguage) => {
    saveDraft(SCOPE, language, code, IDE_STARTERS[language]);
    saveLanguage(SCOPE, next);
    setLanguage(next);
    setCode(loadDraft(SCOPE, next) ?? IDE_STARTERS[next]);
    setResults(null);
  };

  const reset = () => {
    clearDraft(SCOPE, language);
    setCode(IDE_STARTERS[language]);
    setTestCases(DEFAULT_CASES);
    setResults(null);
  };

  const run = useCallback(() => {
    if (pending) return;
    const cases = testCases.filter((tc) => tc.input.trim() || tc.expectedOutput.trim());
    const payload = cases.length ? cases : [{ input: '', expectedOutput: '' }];
    setRanLanguage(language);
    startTransition(async () => {
      setResults(await runIdeCode({ language, code, testCases: payload }));
    });
  }, [code, language, pending, testCases]);

  // One pane at a time on a phone: a finished run takes the screen, and — the editor's pane being hidden then — focus moves
  // to the output, so keyboards and screen readers land on it (the live region below announces the outcome).
  useEffect(() => {
    if (!results || pending || !isNarrow()) return;
    setView('output');
    const id = window.requestAnimationFrame(() => outputPane.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(id);
  }, [results, pending]);

  const runRef = useRef(run);
  runRef.current = run;
  const onRun = useCallback(() => runRef.current(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      onRun();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRun]);

  return (
    <main className={s.root} data-view={view}>
      <h1 className="sr-only">IDE playground</h1>
      {/* Below 1024 px: which pane is showing. Hidden on a laptop, where all three are. */}
      <div className={s.viewSwitch}>
        <Tabs tabs={PHONE_VIEWS} value={view} onChange={(v) => setView(v as PhoneView)} variant="pills" aria-label="Code, test cases or output" />
      </div>
      <aside className={s.cases} aria-label="Test cases">
        <TestCaseManager testCases={testCases} onTestCasesChange={setTestCases} />
      </aside>
      <div className={s.main}>
        <section className={s.editorPane} aria-label="Code">
          <div className={s.toolbar}>
            <LanguageSelector value={language} onChange={switchLanguage} disabled={pending} />
            <Tooltip content="Back to the starter snippet and sample cases">
              <Button variant="ghost" size="sm" icon="refresh" onClick={reset} disabled={pending} aria-label="Reset the playground" className={s.resetBtn} />
            </Tooltip>
            <span className={s.spacer} />
            <Button variant="primary" size="sm" icon="play" onClick={onRun} loading={pending} kbd={touch ? undefined : `${mod}↵`} className={s.runBtn} data-testid="ide-run">
              Run
            </Button>
          </div>
          <div className={s.editorArea}>
            <CodeEditor
              language={language}
              value={code}
              onChange={setCode}
              onRun={onRun}
              onSubmit={onRun}
              ariaLabel={`${LANGUAGE_META[language].label} playground code`}
              handleRef={editor}
            />
          </div>
        </section>
        <section ref={outputPane} className={s.output} aria-label="Output" tabIndex={-1} data-testid="ide-output">
          {/* Always mounted, so the outcome is announced when the run finishes. */}
          <div className="sr-only" role="status" aria-live="polite">
            {!pending && results ? runSummary(results) : ''}
          </div>
          <IdeOutputDisplay results={results} pending={pending} language={ranLanguage} />
        </section>
      </div>
    </main>
  );
}
