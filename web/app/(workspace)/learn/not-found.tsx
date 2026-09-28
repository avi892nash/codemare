import { NotFound } from '@/components/states/NotFound';

/** Unknown track, lesson or checkpoint (its secondary action leads back to /learn). */
export default function LearnNotFound() {
  return (
    <main style={{ flex: 1, display: 'flex', overflowY: 'auto' }} className="scroll">
      <NotFound
        title="Lesson not found"
        description="That track, lesson or checkpoint doesn’t exist — it may have been renamed."
      />
    </main>
  );
}
