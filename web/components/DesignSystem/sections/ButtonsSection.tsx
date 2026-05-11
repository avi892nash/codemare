import { DSSection } from '../DSSection';
import { Button } from '../../ui/Button';

export function ButtonsSection() {
  return (
    <DSSection kicker="07 — Buttons" title="Six variants, four sizes" span={7}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" icon="play">Run</Button>
        <Button variant="primary" icon="send">Submit</Button>
        <Button variant="default">Reset stub</Button>
        <Button variant="outline">Editorial</Button>
        <Button variant="ghost"   icon="copy">Copy</Button>
        <Button variant="accent"  icon="bolt">Faster than 91%</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="lg" variant="primary">Submit solution</Button>
        <Button size="md" variant="default" kbd="⌘ ↵">Run tests</Button>
        <Button size="sm" variant="ghost"   icon="refresh">Re-run</Button>
        <Button size="xs" variant="default">xs</Button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="success" icon="check">Accepted</Button>
        <Button variant="danger"  icon="alert">Killed</Button>
      </div>
    </DSSection>
  );
}
