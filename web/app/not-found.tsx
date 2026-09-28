import type { Metadata } from 'next';
import { NotFound } from '@/components/states/NotFound';

export const metadata: Metadata = {
  title: 'Not found · Codemare',
  robots: { index: false },
};

/** Unmatched URLs and notFound() calls without a closer boundary. */
export default function NotFoundPage() {
  return <NotFound fullPage />;
}
