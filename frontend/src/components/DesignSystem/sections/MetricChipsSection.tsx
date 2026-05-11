import { DSSection } from '../DSSection';
import { MetricChip } from '../../ui/MetricChip';

export function MetricChipsSection() {
  return (
    <DSSection kicker="06 — Metric chips" title="The product's reason to exist" span={6}>
      <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
        <MetricChip label="Runtime" value="0.21" unit="ms" percentile={91} icon="zap" />
        <MetricChip label="Memory"  value="2.1"  unit="MB" percentile={73} icon="memory" />
        <MetricChip label="Compile" value="184"  unit="ms" />
        <MetricChip label="Tests"   value="58"   unit="/ 58" />
      </div>
      <div className="card" style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <MetricChip label="Runtime" value="0.21" unit="ms" percentile={91} size="lg" icon="zap" />
        <MetricChip label="Memory"  value="2.1"  unit="MB" percentile={73} size="lg" icon="memory" />
        <MetricChip label="Wall"    value="1.4"  unit="ms" size="lg" />
      </div>
    </DSSection>
  );
}
