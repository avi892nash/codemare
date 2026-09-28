'use client';

import { runCppAction } from '@/app/(workspace)/library/actions';
import { RunnableCodeBlock } from '@/components/ui/RunnableCodeBlock';

/**
 * An article's C++ as an editable, runnable block. Runs go through a server
 * action → compile service (/v1/ide/execute), rate-limited per user.
 */
export function ArticleCode({ code, filename }: { code: string; filename: string }) {
  return <RunnableCodeBlock code={code} language="cpp" filename={filename} run={(src, stdin) => runCppAction(src, stdin)} />;
}
