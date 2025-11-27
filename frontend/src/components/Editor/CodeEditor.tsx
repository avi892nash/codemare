import { useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import { useEditor } from '../../context/EditorContext';

const LANGUAGE_MAP: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  java: 'java',
};

export function CodeEditor() {
  const { code, setCode, selectedLanguage, currentProblem } = useEditor();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;

    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: selectedLanguage === 'python' ? 4 : 2,
    });

    // Focus editor
    editor.focus();
  };

  const handleCodeChange = (value: string | undefined) => {
    setCode(value || '');
  };

  // Load starter code when problem or language changes
  useEffect(() => {
    if (currentProblem) {
      const starterCode = currentProblem.starterCode[selectedLanguage];
      setCode(starterCode);
    }
  }, [currentProblem, selectedLanguage, setCode]);

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={LANGUAGE_MAP[selectedLanguage]}
        value={code}
        onChange={handleCodeChange}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          selectOnLineNumbers: true,
          roundedSelection: false,
          readOnly: false,
          cursorStyle: 'line',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
