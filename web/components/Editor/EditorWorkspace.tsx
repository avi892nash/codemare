'use client';

import { useState } from 'react';
import type { ExecutionResponse, Language, Problem } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { CodeEditor } from './CodeEditor';
import { LanguageSelector } from './LanguageSelector';
import { OutputDisplay } from '@/components/Results/OutputDisplay';
import { runSolution } from '@/app/(workspace)/p/[id]/actions';

/**
 * The right pane of the problem-detail workspace: toolbar (language picker
 * + reset + run + submit) on top, Monaco editor in the middle, results
 * panel on the bottom.
 *
 * Submit calls the runSolution server action, which proxies to the compile
 * service over INTERNAL_TOKEN — the browser never sees the secret.
 */
export function EditorWorkspace({ problem }: { problem: Problem }) {
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState<string>(problem.starterCode?.[language] ?? '');
  const [results, setResults] = useState<ExecutionResponse | null>(null);
  const [busy, setBusy] = useState(false);

  function switchLanguage(next: Language) {
    setLanguage(next);
    setCode(problem.starterCode?.[next] ?? '');
    setResults(null);
  }

  function reset() {
    setCode(problem.starterCode?.[language] ?? '');
    setResults(null);
  }

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await runSolution({ problemId: problem.id, language, code });
      setResults(r);
    } finally {
      setBusy(false);
    }
  }

  return (
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LanguageSelector value={language} onChange={switchLanguage} />
          <span style={{ width: 1, height: 18, background: 'var(--line-2)', margin: '0 4px' }} />
          <Button variant="ghost" size="sm" icon="refresh" onClick={reset} disabled={busy}>
            Reset stub
          </Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="default" size="md" icon="play" onClick={submit} disabled={busy} kbd="⌘ ↵">
            Run
          </Button>
          <Button variant="primary" size="md" icon="send" onClick={submit} disabled={busy}>
            {busy ? 'Running…' : 'Submit'}
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <CodeEditor language={language} value={code} onChange={setCode} />
      </div>

      <div style={{ height: '50%', borderTop: '1px solid var(--line-2)', overflow: 'hidden', minHeight: 0 }}>
        <OutputDisplay results={results} />
      </div>
    </div>
  );
}
