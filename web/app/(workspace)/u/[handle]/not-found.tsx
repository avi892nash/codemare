import { NotFound } from '@/components/states/NotFound';

/** Unknown handle. */
export default function ProfileNotFound() {
  return (
    <main style={{ flex: 1, display: 'flex', overflowY: 'auto' }} className="scroll">
      <NotFound
        title="No one goes by that handle"
        description="There is no profile at this address. Handles are 3–24 lowercase letters, digits or underscores."
      />
    </main>
  );
}
