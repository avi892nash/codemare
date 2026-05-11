import { ExecutionResponse } from '../../types/execution';
import { TestCaseResults } from './TestCaseResults';
import { MetricChip, Pill, fmtMem, fmtTime } from '../ui/primitives';
import { Icon } from '../ui/Icon';

interface OutputDisplayProps {
  results: ExecutionResponse | null;
}

type Verdict =
  | { kind: 'OK';   tone: 'ok'   }
  | { kind: 'WA';   tone: 'warn' }
  | { kind: 'TLE';  tone: 'err'  }
  | { kind: 'MLE';  tone: 'err'  }
  | { kind: 'RE';   tone: 'err'  }
  | { kind: 'CE';   tone: 'err'  }
  | { kind: 'XX';   tone: 'err'  };

const VERDICT_TITLE: Record<Verdict['kind'], string> = {
  OK:  'Accepted',
  WA:  'Wrong Answer',
  TLE: 'Time Limit Exceeded',
  MLE: 'Memory Limit Exceeded',
  RE:  'Runtime Error',
  CE:  'Compilation Error',
  XX:  'Sandbox Error',
};

function inferVerdict(r: ExecutionResponse): Verdict {
  const s = r.status;
  // Backend may return any of OK / TLE / MLE / RE / CE / XX. WA is a frontend
  // verdict for "ran cleanly, output mismatched" (status OK, success false).
  if (s && s !== 'OK') return { kind: s as Verdict['kind'], tone: 'err' } as Verdict;
  if (r.error) return { kind: 'XX', tone: 'err' };
  if (!r.success) return { kind: 'WA', tone: 'warn' };
  return { kind: 'OK', tone: 'ok' };
}

export function OutputDisplay({ results }: OutputDisplayProps) {
  if (!results) {
    return <EmptyState />;
  }

  const verdict = inferVerdict(results);
  const [tVal, tUnit] = fmtTime(results.runMs ?? results.executionTime);
  const [mVal, mUnit] = fmtMem(results.memoryKb ?? (results.memoryUsed ? results.memoryUsed / 1024 : null));
  const [cVal, cUnit] = fmtTime(results.compileMs);
  const [wVal, wUnit] = fmtTime(results.wallMs);

  const accentColor =
    verdict.tone === 'ok' ? 'var(--ok)' :
    verdict.tone === 'warn' ? 'var(--warn)' :
    'var(--err)';

  return (
    <div className="cm scroll" style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-0)' }}>
      <div style={{ padding: 18 }}>
        {/* Verdict banner */}
        <div className="card" style={{
          padding: 18,
          marginBottom: 16,
          borderColor: `color-mix(in oklab, ${accentColor} 35%, var(--line-2))`,
          background: `color-mix(in oklab, ${accentColor} 7%, var(--bg-1))`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <Icon name={verdict.kind === 'OK' ? 'check-circle' : verdict.kind === 'WA' ? 'alert-circle' : 'alert'}
              size={22} style={{ color: accentColor }} />
            <h2 style={{
              margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.3,
              color: accentColor,
            }}>{VERDICT_TITLE[verdict.kind]}</h2>
            <span style={{ flex: 1 }} />
            <Pill tone={verdict.tone} size="md" className="mono">{verdict.kind}</Pill>
          </div>
          <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 13 }}>
            {results.totalPassed} / {results.totalTests} test cases passed
            {results.error && <> · {results.error}</>}
          </p>
        </div>

        {/* Metric strip */}
        <div className="card" style={{
          padding: 18,
          marginBottom: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 18,
        }}>
          <MetricChip label="Runtime" value={tVal} unit={tUnit} icon="zap" />
          <MetricChip label="Memory" value={mVal} unit={mUnit} icon="memory" />
          {results.compileMs != null && results.compileMs > 0 && (
            <MetricChip label="Compile" value={cVal} unit={cUnit} icon="cpu" />
          )}
          {results.wallMs != null && (
            <MetricChip label="Wall" value={wVal} unit={wUnit} icon="clock" />
          )}
          <MetricChip label="Tests" value={`${results.totalPassed}`} unit={`/ ${results.totalTests}`} icon="check" />
        </div>

        {/* Per-test breakdown */}
        {results.testResults.length > 0 && (
          <>
            <h3 style={{
              margin: '0 0 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              color: 'var(--fg-3)',
            }}>Test results</h3>
            <TestCaseResults results={results.testResults} />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="cm" style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-0)',
    }}>
      <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
        <Icon name="play" size={28} style={{ color: 'var(--fg-4)', marginBottom: 12 }} />
        <p style={{ margin: 0, fontSize: 15, color: 'var(--fg-1)' }}>No results yet</p>
        <p style={{ margin: '4px 0 0', fontSize: 12.5 }}>Run your code to see runtime and memory.</p>
      </div>
    </div>
  );
}
