import { LoadingState } from '@/components/states/LoadingState';

/**
 * Skeleton for the /submissions list. It lives in the (list) route group so
 * it does NOT wrap /submissions/[id]: a loading boundary there would let the
 * shell stream before the owner check, turning notFound() into a 404 page
 * served with HTTP 200.
 */
export default function SubmissionsLoading() {
  return <LoadingState variant="list" label="Loading submissions…" />;
}
