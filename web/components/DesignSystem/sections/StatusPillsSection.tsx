import { DSSection } from '../DSSection';
import { StatusPill, type StatusCode } from '../../ui/StatusPill';
import { DifficultyPill } from '../../ui/DifficultyPill';
import { Pill } from '../../ui/Pill';

const ALL_STATUSES: StatusCode[] = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX', 'PND'];
const STATUSES_WITH_LONG: StatusCode[] = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE'];

export function StatusPillsSection() {
  return (
    <DSSection kicker="05 — Status pills" title="OK · WA · TLE · MLE · RE · CE · XX" span={6}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ALL_STATUSES.map((s) => <StatusPill key={s} code={s} size="md" />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {STATUSES_WITH_LONG.map((s) => <StatusPill key={s} code={s} size="md" showLong />)}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <DifficultyPill level="Easy" />
        <DifficultyPill level="Medium" />
        <DifficultyPill level="Hard" />
        <span style={{ width: 1, height: 18, background: 'var(--line-2)', margin: '0 6px' }} />
        <Pill icon="hash">array</Pill>
        <Pill icon="hash">two-pointers</Pill>
        <Pill icon="hash">dp</Pill>
      </div>
    </DSSection>
  );
}
