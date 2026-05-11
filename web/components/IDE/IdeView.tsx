'use client';

import { useState, useTransition } from 'react';
import type {
  IdeExecutionResponse,
  IdeTestCase,
  Language,
} from '@/lib/types';
import { Button, Pill } from '@/components/ui/primitives';
import { CodeEditor } from '@/components/Editor/CodeEditor';
import { LanguageSelector } from '@/components/Editor/LanguageSelector';
import { TestCaseManager } from './TestCaseManager';
import { IdeOutputDisplay } from './IdeOutputDisplay';
import { runIdeCode } from '@/app/(workspace)/ide/actions';

/**
 * Default starter snippets per language — used for the IDE first-run
 * experience and the Reset button. Kept inline (rather than fetched) so
 * the IDE page renders instantly.
 */
const STARTERS: Record<Language, string> = {
  python: `# Read stdin, write to stdout. Each call to input() reads one line.\na = int(input())\nb = int(input())\nprint(a + b)\n`,
  javascript: `// Read stdin, write to stdout. Reads the entire stream then parses.\nconst data = require('fs').readFileSync(0, 'utf8').split('\\n');\nconst a = parseInt(data[0]);\nconst b = parseInt(data[1]);\nconsole.log(a + b);\n`,
  cpp: `#include <iostream>\nint main() {\n    int a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << std::endl;\n    return 0;\n}\n`,
  java: `import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt();\n        int b = sc.nextInt();\n        System.out.println(a + b);\n    }\n}\n`,
};

export function IdeView() {
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState<string>(STARTERS[language]);
  const [testCases, setTestCases] = useState<IdeTestCase[]>([
    { input: '2\n3', expectedOutput: '5' },
  ]);
  const [results, setResults] = useState<IdeExecutionResponse | null>(null);
  const [isPending, startTransition] = useTransition();

  function switchLanguage(next: Language) {
    setLanguage(next);
    setCode(STARTERS[next]);
    setResults(null);
  }

  function reset() {
    setCode(STARTERS[language]);
    setResults(null);
    setTestCases([{ input: '2\n3', expectedOutput: '5' }]);
  }

  function submit() {
    const nonEmpty = testCases.filter((tc) => tc.input.trim() || tc.expectedOutput.trim());
    if (nonEmpty.length === 0) return;
    if (!code.trim()) return;
    startTransition(async () => {
      const r = await runIdeCode({ code, language, testCases: nonEmpty });
      setResults(r);
    });
  }

  return (
    <div
      className="cm"
      style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <div
        style={{
          width: 320,
          flex: 'none',
          borderRight: '1px solid var(--line-2)',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <TestCaseManager testCases={testCases} onTestCasesChange={setTestCases} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 14px',
            background: 'var(--bg-1)',
            borderBottom: '1px solid var(--line-2)',
            flex: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill tone="accent" size="sm">IDE</Pill>
            <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>
              Free-form playground · custom stdin/stdout
            </span>
            <span style={{ width: 1, height: 18, background: 'var(--line-2)', margin: '0 4px' }} />
            <LanguageSelector value={language} onChange={switchLanguage} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant="ghost" size="sm" icon="refresh" onClick={reset} disabled={isPending}>
              Reset
            </Button>
            <Button variant="primary" size="md" icon="play" onClick={submit} disabled={isPending} kbd="⌘ ↵">
              {isPending ? 'Running…' : 'Run'}
            </Button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <CodeEditor language={language} value={code} onChange={setCode} />
        </div>

        <div style={{ height: '50%', borderTop: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
          <IdeOutputDisplay results={results} />
        </div>
      </div>
    </div>
  );
}
