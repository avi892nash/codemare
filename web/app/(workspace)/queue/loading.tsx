import { LoadingState } from '@/components/states/LoadingState';

export default function QueueLoading() {
  return <LoadingState label="Loading your queue…" rows={6} />;
}
