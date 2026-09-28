'use server';

import { revalidatePath } from 'next/cache';
import type { RunResult } from '@/components/ui/RunnableCodeBlock';
import { markRead, runArticleCode } from '@/lib/server/library';
import { libraryViewer } from './viewer';

/**
 * Library server actions. Each re-checks library access itself (a server
 * action is a public POST endpoint): no access → the same "not found" the
 * pages give.
 */

export async function markReadAction(articleId: unknown): Promise<{ ok: true; readAt: string } | { ok: false; error: string }> {
  const viewer = await libraryViewer();
  if (!viewer || typeof articleId !== 'string') return { ok: false, error: 'Not found' };
  const res = await markRead(viewer, articleId);
  if (!res) return { ok: false, error: 'Not found' };
  revalidatePath('/library', 'layout');
  return { ok: true, readAt: res.readAt.toISOString() };
}

export async function runCppAction(code: unknown, stdin: unknown): Promise<RunResult> {
  const viewer = await libraryViewer();
  if (!viewer) return { status: 'XX', error: 'Not found' };
  return runArticleCode(viewer, code, stdin);
}
