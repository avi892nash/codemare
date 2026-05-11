import { LanguageSelector } from './LanguageSelector';
import { useEditor } from '../../context/EditorContext';
import { Button } from '../ui/primitives';

interface EditorToolbarProps {
  onRun: () => void;
  onReset: () => void;
}

export function EditorToolbar({ onRun, onReset }: EditorToolbarProps) {
  const { isExecuting, currentProblem } = useEditor();
  const disabled = !currentProblem || isExecuting;

  return (
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
        <LanguageSelector />
        <span style={{ width: 1, height: 18, background: 'var(--line-2)', margin: '0 4px' }} />
        <Button variant="ghost" size="sm" icon="refresh" onClick={onReset} disabled={disabled}>
          Reset stub
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="default" size="md" icon="play" onClick={onRun} disabled={disabled} kbd="⌘ ↵">
          Run
        </Button>
        <Button variant="primary" size="md" icon="send" onClick={onRun} disabled={disabled}>
          {isExecuting ? 'Running…' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}
