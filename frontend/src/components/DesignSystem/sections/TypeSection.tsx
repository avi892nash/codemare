import { DSSection } from '../DSSection';
import { TypeRow } from '../TypeRow';

export function TypeSection() {
  return (
    <DSSection kicker="03 — Type" title="Inter for prose, JetBrains Mono for metrics" span={7}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TypeRow label="display"  size={48} weight={600} sample="Solve in microseconds." />
        <TypeRow label="h1"       size={32} weight={600} sample="Container With Most Water" />
        <TypeRow label="h2"       size={20} weight={600} sample="Test results · 58 / 58 passed" />
        <TypeRow label="body"     size={14} weight={400} sample="Find two lines that, with the x-axis, form a container holding the most water." />
        <TypeRow label="metric"   size={28} weight={500} sample="0.21 ms · 2.1 MB" font="var(--font-mono)" />
        <TypeRow label="caption"  size={11} weight={500} sample="FASTER THAN 87% OF PYTHON SUBMISSIONS" />
      </div>
    </DSSection>
  );
}
