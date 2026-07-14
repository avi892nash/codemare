'use client';

import dynamic from 'next/dynamic';
import type { Language } from '@/lib/types';

// Monaco needs to load on the client only. Suspend with a skeleton so the
// editor area doesn't collapse during the chunk download.
const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div
      className="skel"
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-2)',
        opacity: 0.5,
      }}
    />
  ),
});

const MONACO_LANG: Record<Language, string> = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  java: 'java',
};

interface CodeEditorProps {
  language: Language;
  value: string;
  onChange: (next: string) => void;
}

export function CodeEditor({ language, value, onChange }: CodeEditorProps) {
  return (
    <div style={{ height: '100%', width: '100%', background: 'var(--bg-2)' }}>
      <Monaco
        language={MONACO_LANG[language]}
        value={value}
        onChange={(v: string | undefined) => onChange(v ?? '')}
        theme="vs-dark"
        options={{
          fontSize: 13,
          fontFamily: 'var(--font-mono), JetBrains Mono, ui-monospace, monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderLineHighlight: 'gutter',
          padding: { top: 12, bottom: 12 },
          tabSize: 4,
          insertSpaces: true,
        }}
      />
    </div>
  );
}
