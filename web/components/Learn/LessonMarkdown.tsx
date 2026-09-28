import { Callout } from '@/components/ui/Callout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Formula } from '@/components/ui/Formula';
import { RunnableCodeBlock, type RunResult } from '@/components/ui/RunnableCodeBlock';
import { normalizeLanguage, type CodeLanguage } from '@/components/ui/highlight';
import { VizMount } from '@/components/Viz/VizMount';
import type { LessonBlock } from '@/lib/lesson-markdown/parse';
import type { QuestionRef } from '@/lib/server/learnViews';
import { Prose } from './Prose';
import { QuestionCard } from './QuestionCard';
import s from './learn.module.css';

/** A server action `(language, code, stdin) → RunResult`; bound per block to a language. */
export type RunSnippetAction = (language: string, code: string, stdin: string) => Promise<RunResult>;

/** Languages the compile service's IDE mode runs today (TypeScript/Go land with the backend upgrade). */
const RUNNABLE: ReadonlySet<CodeLanguage> = new Set(['python', 'javascript', 'cpp', 'java', 'typescript', 'go']);

interface Ctx {
  questions: ReadonlyMap<string, QuestionRef>;
  runSnippet?: RunSnippetAction;
}

function Block({ block, ctx, compact }: { block: LessonBlock; ctx: Ctx; compact: boolean }) {
  switch (block.type) {
    case 'markdown':
      return <Prose md={block.md} compact={compact} />;
    case 'code': {
      const lang = normalizeLanguage(block.lang);
      if (block.run && lang && RUNNABLE.has(lang) && ctx.runSnippet) {
        return (
          <RunnableCodeBlock
            code={block.code}
            language={lang}
            filename={block.title ?? undefined}
            stdin={block.stdin ?? undefined}
            run={ctx.runSnippet.bind(null, lang)}
          />
        );
      }
      return <CodeBlock code={block.code} language={block.lang ?? undefined} filename={block.title ?? undefined} copy />;
    }
    case 'callout':
      return (
        <Callout kind={block.kind} title={block.title ?? undefined} time={block.time ?? undefined} space={block.space ?? undefined}>
          {block.children.length > 0 && <BlockList blocks={block.children} ctx={ctx} compact />}
        </Callout>
      );
    case 'formula':
      return <Formula tex={block.tex} style={{ margin: 0 }} />;
    case 'viz':
      return <VizMount id={block.id} />;
    case 'question':
      return <QuestionCard slug={block.slug} question={ctx.questions.get(block.slug)} />;
  }
}

function BlockList({ blocks, ctx, compact }: { blocks: readonly LessonBlock[]; ctx: Ctx; compact: boolean }) {
  return (
    <div className={s.lessonBody} style={compact ? { gap: 10 } : undefined}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} ctx={ctx} compact={compact} />
      ))}
    </div>
  );
}

/**
 * A parsed lesson body (lib/lesson-markdown/parse.ts) mapped onto the ui
 * kit: prose → sanitized markdown, ```lang run → RunnableCodeBlock wired
 * to `runSnippet`, other fences → CodeBlock, callouts → Callout, $$ →
 * Formula, :::viz → a lazily loaded visualization, :::question → a link
 * card. Server component; only the runnable blocks and visualizations
 * hydrate. Without `runSnippet`, runnable blocks render read-only.
 */
export function LessonMarkdown({
  blocks,
  questions = new Map(),
  runSnippet,
}: {
  blocks: readonly LessonBlock[];
  questions?: ReadonlyMap<string, QuestionRef>;
  runSnippet?: RunSnippetAction;
}) {
  return <BlockList blocks={blocks} ctx={{ questions, runSnippet }} compact={false} />;
}
