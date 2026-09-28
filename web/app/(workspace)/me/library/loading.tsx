import { LoadingState } from '@/components/states/LoadingState';

export default function MyLibraryLoading() {
  return <LoadingState label="Loading your library…" rows={5} />;
}
