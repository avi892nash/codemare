import { NotFound } from '@/components/states/NotFound';

/** Unknown slug (or a draft you can't see) — inside the workspace shell. */
export default function ProblemNotFound() {
  return (
    <NotFound
      title="Problem not found"
      description="There’s no problem at this address — it may have been renamed, or it isn’t published yet."
      homeLabel="Find a problem on the map"
    />
  );
}
