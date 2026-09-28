import { NotFound } from '@/components/states/NotFound';

/** Unknown handle. */
export default function ProfileNotFound() {
  return (
    <NotFound
      title="No one goes by that handle"
      description="There is no profile at this address. Handles are 3–24 lowercase letters, digits or underscores."
    />
  );
}
