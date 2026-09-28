import { LoadingState } from '@/components/states/LoadingState';

export default function MapLoading() {
  return <LoadingState label="Loading the tier map…" rows={6} />;
}
