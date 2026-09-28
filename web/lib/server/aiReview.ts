import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Example, Signature, SupportedLanguage } from '@/lib/types';
import { prisma } from './db';
import { DomainError, InvalidInput, NotFoundError } from './errors';
import { exampleSchema, parseJsonColumn, signatureSchema } from './schemas';

/**
 * AI code review of an accepted submission (spec §3.10). Optional:
 * FEATURE_AI_REVIEW=true and ANTHROPIC_API_KEY. It only ever runs after the
 * judge accepted a submission — it never gates or replaces the tests.
 *
 * Prompt layout, stable → volatile, so the prefix caches:
 *   system[0]  the review instructions   (cache_control: ephemeral — same for everyone)
 *   system[1]  the problem               (cache_control: ephemeral — same for every review of it)
 *   user       the learner's code, language and judge metrics
 */

export type ReviewDepth = 'quick' | 'deep';

/** The environment the feature reads (process.env by default; tests pass their own). */
export type ReviewEnv = Record<string, string | undefined>;

/** Default model, and the one "Deeper review" escalates to (overridable per env). */
export const AI_REVIEW_MODELS: Record<ReviewDepth, string> = {
  quick: 'claude-haiku-4-5-20251001',
  deep: 'claude-sonnet-5',
};

export function aiReviewModel(depth: ReviewDepth, env: ReviewEnv = process.env): string {
  const override = depth === 'deep' ? env.AI_REVIEW_DEEP_MODEL : env.AI_REVIEW_MODEL;
  return override?.trim() || AI_REVIEW_MODELS[depth];
}

export function aiReviewEnabled(env: ReviewEnv = process.env): boolean {
  return env.FEATURE_AI_REVIEW === 'true' && !!env.ANTHROPIC_API_KEY?.trim();
}

export class AiReviewDisabled extends DomainError {
  readonly code = 'ai_review_disabled';
  readonly status = 404;
  constructor() {
    super('AI review is not enabled.');
    this.name = 'AiReviewDisabled';
  }
}

export class AiReviewFailed extends DomainError {
  readonly code = 'ai_review_failed';
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
    this.name = 'AiReviewFailed';
  }
}

/** The stable half of the prompt. Changing it invalidates every cached prefix. */
export const REVIEW_INSTRUCTIONS = `You are the code reviewer on Codemare, a platform where people practice data structures and algorithms. A learner's solution has just been ACCEPTED by the judge: it passed every test, including hidden ones. Correctness has been established — your job is to help them write better solutions next time, not to re-judge this one.

Write the review in GitHub-flavored Markdown with exactly these sections, in this order:

### Verdict
One or two sentences: what approach they used and how good it is for this problem.

### Complexity
Time and space complexity in Big-O, each with a one-line justification tied to their code. If a better bound exists for this problem, name it and the idea that reaches it.

### What works
Up to three specific strengths (a well-chosen data structure, a clean invariant, a correct edge-case guard).

### Improvements
Up to four concrete suggestions, most valuable first: asymptotic improvements, then constant factors, then idiomatic use of their language, then readability. Show each with a short code snippet in their language when it helps. Skip style nits a formatter would fix.

### Edge cases
Inputs worth re-checking mentally, even though the tests passed (empty input, duplicates, negatives, overflow, extremes of the constraints). Say briefly why each matters for this code.

Rules:
- Be specific to their code; quote identifiers from it. Never invent behavior the code doesn't have.
- Do not rewrite the whole solution. Snippets stay under 15 lines.
- Runtime is CPU time measured by the judge in microseconds; "beats N%" compares it with other accepted solutions in the same language. Mention it only if it explains something.
- If the solution is already optimal and clean, say so plainly and keep the review short.
- "Depth: quick" means under about 250 words. "Depth: deep" means a thorough review: also discuss alternative approaches and their trade-offs, and give a brief argument for why the algorithm is correct.
- Never reveal, guess or discuss hidden test data.`;

export interface ReviewProblem {
  title: string;
  difficulty: string;
  statementMd: string;
  constraints: string[];
  examples: Example[];
  functionName: string;
  signature: Signature;
}

export interface ReviewSubmission {
  language: SupportedLanguage;
  code: string;
  runtimeUs: number | null;
  memoryKb: number | null;
  percentile: number | null;
  totalTests: number;
}

function signatureLine(fn: string, sig: Signature): string {
  return `${fn}(${sig.params.map((p) => `${p.name}: ${p.type}`).join(', ')}) -> ${sig.returns}`;
}

/** The problem block — identical for every review of the same problem. */
export function problemPrompt(p: ReviewProblem): string {
  const parts = [
    `## Problem: ${p.title} (${p.difficulty})`,
    p.statementMd.trim(),
    `Function: \`${signatureLine(p.functionName, p.signature)}\``,
  ];
  if (p.examples.length) {
    parts.push(
      '### Examples\n' +
        p.examples
          .map((e, i) => `${i + 1}. Input: ${e.input}\n   Output: ${e.output}${e.explanation ? `\n   Explanation: ${e.explanation}` : ''}`)
          .join('\n')
    );
  }
  if (p.constraints.length) parts.push(`### Constraints\n${p.constraints.map((c) => `- ${c}`).join('\n')}`);
  return parts.join('\n\n');
}

const FENCE: Record<SupportedLanguage, string> = {
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  cpp: 'cpp',
  java: 'java',
  go: 'go',
};

/** The volatile block — this learner's code and the judge's numbers. */
export function submissionPrompt(s: ReviewSubmission, depth: ReviewDepth): string {
  const metrics = [
    `tests passed: ${s.totalTests}/${s.totalTests}`,
    s.runtimeUs != null ? `CPU time: ${s.runtimeUs} µs (all tests)` : null,
    s.memoryKb != null ? `peak memory: ${s.memoryKb} KB` : null,
    s.percentile != null ? `beats ${s.percentile}% of accepted ${s.language} solutions` : null,
  ].filter(Boolean);
  // A fence longer than any backtick run in the code keeps it intact.
  const longest = Math.max(2, ...[...s.code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return [
    `Depth: ${depth}`,
    `Language: ${s.language}`,
    `Judge: ${metrics.join(' · ')}`,
    `${fence}${FENCE[s.language]}\n${s.code}\n${fence}`,
    'Review this accepted solution.',
  ].join('\n\n');
}

/** The Messages API request for a review (pure — unit-tested without the network). */
export function buildReviewRequest(
  problem: ReviewProblem,
  submission: ReviewSubmission,
  depth: ReviewDepth,
  env: ReviewEnv = process.env
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: aiReviewModel(depth, env),
    max_tokens: depth === 'deep' ? 16000 : 8000,
    system: [
      { type: 'text', text: REVIEW_INSTRUCTIONS, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: problemPrompt(problem), cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: submissionPrompt(submission, depth) }],
  };
}

/** What the review needs from the SDK — `new Anthropic()` satisfies it; tests pass a fake. */
export interface ReviewClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { timeout?: number; signal?: AbortSignal }): PromiseLike<Anthropic.Message>;
  };
}

export interface AiReviewView {
  id: string;
  submissionId: string;
  model: string;
  depth: ReviewDepth;
  contentMd: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  createdAt: string;
}

function depthOf(model: string, env: ReviewEnv): ReviewDepth {
  return model === aiReviewModel('deep', env) ? 'deep' : 'quick';
}

function toView(
  r: { id: string; submissionId: string; model: string; contentMd: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; createdAt: Date },
  env: ReviewEnv
): AiReviewView {
  return { ...r, depth: depthOf(r.model, env), createdAt: r.createdAt.toISOString() };
}

const constraintsSchema = z.array(z.string());

async function loadAccepted(userId: string, submissionId: string) {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      userId: true,
      kind: true,
      status: true,
      language: true,
      code: true,
      runtimeUs: true,
      memoryKb: true,
      percentile: true,
      totalTests: true,
      question: {
        select: { slug: true, title: true, difficulty: true, statementMd: true, constraints: true, examples: true, functionName: true, signature: true },
      },
    },
  });
  if (!s || s.userId !== userId) throw new NotFoundError('submission', submissionId);
  if (s.kind !== 'submit' || s.status !== 'OK' || !s.question) {
    throw new InvalidInput('AI review is only available for accepted submissions.');
  }
  return { ...s, question: s.question };
}

/** Reviews already stored for one of the user's submissions (oldest first). */
export async function listAiReviews(userId: string, submissionId: string, env: ReviewEnv = process.env): Promise<AiReviewView[]> {
  const s = await prisma.submission.findUnique({ where: { id: submissionId }, select: { userId: true } });
  if (!s || s.userId !== userId) throw new NotFoundError('submission', submissionId);
  const rows = await prisma.aiReview.findMany({ where: { submissionId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => toView(r, env));
}

/**
 * Review an accepted submission at `depth`, storing the result with its
 * token usage. One review per (submission, model): asking again returns the
 * stored one without calling the API.
 */
export async function requestAiReview(
  userId: string,
  submissionId: string,
  depth: ReviewDepth,
  deps: { client?: ReviewClient; env?: ReviewEnv } = {}
): Promise<{ review: AiReviewView; cached: boolean }> {
  const env = deps.env ?? process.env;
  if (!aiReviewEnabled(env)) throw new AiReviewDisabled();
  const s = await loadAccepted(userId, submissionId);
  const model = aiReviewModel(depth, env);

  const existing = await prisma.aiReview.findFirst({ where: { submissionId, model }, orderBy: { createdAt: 'desc' } });
  if (existing) return { review: toView(existing, env), cached: true };

  const q = s.question;
  const request = buildReviewRequest(
    {
      title: q.title,
      difficulty: q.difficulty,
      statementMd: q.statementMd,
      constraints: parseJsonColumn(constraintsSchema, q.constraints, `questions.constraints (${q.slug})`),
      examples: parseJsonColumn(z.array(exampleSchema), q.examples, `questions.examples (${q.slug})`),
      functionName: q.functionName,
      signature: parseJsonColumn(signatureSchema, q.signature, `questions.signature (${q.slug})`),
    },
    {
      language: s.language,
      code: s.code,
      runtimeUs: s.runtimeUs == null ? null : Number(s.runtimeUs),
      memoryKb: s.memoryKb,
      percentile: s.percentile,
      totalTests: s.totalTests,
    },
    depth,
    env
  );

  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(request, { timeout: depth === 'deep' ? 180_000 : 90_000 });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiReviewFailed('The reviewer is busy right now. Try again in a minute.', 503);
    if (e instanceof Anthropic.APIConnectionError) throw new AiReviewFailed('Couldn’t reach the reviewer. Try again.', 503);
    if (e instanceof Anthropic.APIError) {
      console.error(`[aiReview] API error ${e.status}:`, e.message);
      throw new AiReviewFailed('The reviewer failed on this one. Try again later.');
    }
    throw e;
  }

  if (message.stop_reason === 'refusal') throw new AiReviewFailed('The reviewer declined to review this submission.', 422);
  let contentMd = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();
  if (!contentMd) throw new AiReviewFailed('The reviewer returned an empty review. Try again.');
  if (message.stop_reason === 'max_tokens') contentMd += '\n\n_(The review was cut off at its length limit.)_';

  const usage = message.usage;
  const row = await prisma.aiReview.create({
    data: {
      submissionId,
      // The requested id (not the echoed one) — it keys the one-review-per-model check.
      model,
      contentMd,
      // Uncached input, including tokens written to the cache (billed as input).
      inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    },
  });
  return { review: toView(row, env), cached: false };
}
