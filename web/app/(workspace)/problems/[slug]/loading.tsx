import { LoadingState } from '@/components/states/LoadingState';

export default function Loading() {
  return <LoadingState variant="editor" label="Loading the problem…" style={{ flex: 1 }} />;
}
