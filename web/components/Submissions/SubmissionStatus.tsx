import type { PillSize } from '@/components/ui/Pill';
import { StatusPill } from '@/components/ui/StatusPill';
import type { SubmissionStatus as Status } from '@/lib/types';

/**
 * A submission's status as a StatusPill: verdict codes as-is (long name for
 * screen readers), queued / running as the pending pill with a spinner.
 */
export function SubmissionStatus({ status, size = 'sm', long = false }: { status: Status; size?: PillSize; long?: boolean }) {
  if (status === 'queued' || status === 'running') {
    return <StatusPill code="PND" size={size} withIcon label={status === 'queued' ? 'Queued' : 'Running'} />;
  }
  return <StatusPill code={status} size={size} showLong={long} withIcon={long} />;
}
