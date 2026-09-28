import { LoadingState } from '@/components/states/LoadingState';
import s from '@/components/Learn/learn.module.css';

export default function LearnLoading() {
  return (
    <div className={`${s.page} scroll`}>
      <LoadingState variant="list" rows={6} label="Loading lessons…" />
    </div>
  );
}
