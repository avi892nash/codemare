import { NotFound } from '@/components/states/NotFound';

/** Unknown id, or someone else's submission. */
export default function SubmissionNotFound() {
  return (
    <NotFound
      title="Submission not found"
      description="It doesn’t exist, or it belongs to another account."
      homeHref="/submissions"
      homeLabel="Your submissions"
      homeIcon="list"
    />
  );
}
