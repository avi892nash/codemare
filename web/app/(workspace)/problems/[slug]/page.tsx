import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { signInHref } from '@/components/Auth/routes';
import { RelatedLessons } from '@/components/Learn/RelatedLessons';
import { LockedQuestion } from '@/components/Problem/LockedQuestion';
import { Markdown } from '@/components/Problem/Markdown';
import { ProblemStatement } from '@/components/Problem/ProblemStatement';
import { SolveWorkspace } from '@/components/Workspace/SolveWorkspace';
import type { GateContext, SubmissionSummary } from '@/components/Workspace/types';
import { canAccessQuestion } from '@/lib/server/access';
import { aiReviewEnabled } from '@/lib/server/aiReview';
import { prisma } from '@/lib/server/db';
import { NotFoundError } from '@/lib/server/errors';
import { getGateAttempt } from '@/lib/server/gates';
import { getHintLadder } from '@/lib/server/hints';
import { lockedTopicBlockers } from '@/lib/server/runner';
import { codeByLanguageSchema, exampleSchema, parseJsonColumn, signatureSchema, testDefSchema } from '@/lib/server/schemas';
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const q = await prisma.question.findUnique({ where: { slug }, select: { title: true, status: true } });
  return { title: q?.status === 'published' ? `${q.title} · Codemare` : 'Problem · Codemare' };
}

const questionSelect = {
  id: true,
  slug: true,
  title: true,
  difficulty: true,
  status: true,
  statementMd: true,
  examples: true,
  constraints: true,
  functionName: true,
  signature: true,
  starterCode: true,
  tests: true,
  referenceSolutions: true,
  tags: true,
  companies: true,
  editorialMd: true,
  timeLimitMs: true,
  topics: { orderBy: { weight: 'desc' as const }, select: { topic: { select: { slug: true, title: true, icon: true } } } },
};

/**
 * /problems/[slug] — the editor. An RSC shell: loads the question, the
 * learner's latest code per language, their recent submissions and best
 * percentile, and renders the SolveWorkspace (Monaco loads on the client).
 * Locked → what's blocking + a link to /map. Unknown slug or someone else's
 * draft → 404. `?attempt=<id>` → gate mode with a countdown.
 */
export default async function ProblemPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(signInHref(`/problems/${slug}`));

  const q = await prisma.question.findUnique({ where: { slug }, select: questionSelect });
  if (!q) notFound();

  const access = await canAccessQuestion(userId, q.id);
  if (!access.ok) {
    if (access.reason === 'draft') notFound();
    return <LockedQuestion title={q.title} difficulty={q.difficulty} blockers={await lockedTopicBlockers(userId, access.lockedTopics)} />;
  }

  // Gate mode: an explicit ?attempt=, or a question reachable only through a running attempt.
  const attemptParam = typeof search.attempt === 'string' ? search.attempt : undefined;
  const attemptId = attemptParam ?? (access.via === 'gate_attempt' ? access.gateAttemptId : undefined);
  let gate: GateContext | undefined;
  if (attemptId) {
    try {
      const view = await getGateAttempt(userId, attemptId);
      if (view.running && view.questions.some((x) => x.questionId === q.id)) {
        gate = {
          attemptId: view.attempt.id,
          deadlineAt: view.attempt.deadlineAt.toISOString(),
          title: view.gate.title,
          passThreshold: view.gate.passThreshold,
          questions: view.questions.map((x) => ({ slug: x.slug, title: x.title, solved: x.solved })),
          backHref: '/map',
        };
      }
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }
  const mode = gate ? 'gate' : 'question';

  const [recent, latestPerLanguage, best, hints] = await Promise.all([
    prisma.submission.findMany({
      where: { userId, questionId: q.id, kind: { in: ['submit', 'gate'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, status: true, language: true, runtimeUs: true, memoryKb: true, percentile: true, createdAt: true },
    }),
    prisma.submission.findMany({
      where: { userId, questionId: q.id, kind: { in: ['run', 'submit', 'gate'] } },
      orderBy: { createdAt: 'desc' },
      distinct: ['language'],
      select: { language: true, code: true, createdAt: true },
    }),
    prisma.submission.aggregate({
      where: { userId, questionId: q.id, kind: 'submit', status: 'OK' },
      _max: { percentile: true },
      _count: { _all: true },
    }),
    gate ? null : getHintLadder(userId, { questionId: q.id }),
  ]);
  const solved = best._count._all > 0 || recent.some((s) => s.status === 'OK');

  const signature = parseJsonColumn(signatureSchema, q.signature, `questions.signature (${q.slug})`);
  const tests = parseJsonColumn(z.array(testDefSchema), q.tests, `questions.tests (${q.slug})`);
  const starterCode = parseJsonColumn(codeByLanguageSchema, q.starterCode, `questions.starter_code (${q.slug})`);
  const references = parseJsonColumn(codeByLanguageSchema, q.referenceSolutions, `questions.reference_solutions (${q.slug})`);
  const examples = parseJsonColumn(z.array(exampleSchema), q.examples, `questions.examples (${q.slug})`);
  const constraints = parseJsonColumn(z.array(z.string()), q.constraints, `questions.constraints (${q.slug})`);
  const languages = LANGUAGES.filter((l) => starterCode[l] !== undefined);

  const latestCode: Partial<Record<SupportedLanguage, string>> = {};
  for (const s of latestPerLanguage) latestCode[s.language] = s.code;
  const initialLanguage = latestPerLanguage.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.language;

  const submissions: SubmissionSummary[] = recent.map((s) => ({
    id: s.id,
    kind: s.kind,
    status: s.status,
    language: s.language,
    runtimeUs: s.runtimeUs == null ? null : Number(s.runtimeUs),
    memoryKb: s.memoryKb,
    percentile: s.percentile,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <SolveWorkspace
      mode={mode}
      problem={{
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        functionName: q.functionName,
        signature,
        languages: languages.length ? [...languages] : [...LANGUAGES],
        starterCode,
        // Hidden tests never leave the server.
        samples: tests.filter((t) => !t.hidden).map((t) => ({ input: t.input, expected: t.expected })),
        timeLimitMs: q.timeLimitMs,
        customInputs: Object.values(references).some((code) => !!code?.trim()),
      }}
      statement={
        <>
          <ProblemStatement
            statementMd={q.statementMd}
            examples={examples}
            constraints={constraints}
            topics={q.topics.map((t) => t.topic)}
            tags={q.tags}
            companies={q.companies}
          />
          {!gate && (
            <Suspense fallback={null}>
              <RelatedLessons questionSlug={q.slug} userId={userId} />
            </Suspense>
          )}
        </>
      }
      editorial={q.editorialMd ? <Markdown>{q.editorialMd}</Markdown> : undefined}
      submissions={submissions}
      latestCode={latestCode}
      initialLanguage={initialLanguage}
      hints={hints ? { target: { questionId: q.id }, initial: hints } : null}
      gate={gate}
      solved={solved}
      bestPercentile={best._max.percentile}
      aiReview={aiReviewEnabled()}
    />
  );
}
