import 'server-only';
import { z } from 'zod';
import { LANGUAGES, VERDICT_LABEL, type SubmissionKind, type SupportedLanguage, type Verdict } from '@/lib/types';
import {
  compile as defaultCompile,
  CompileServiceError,
  type CompileClient,
  type RunRequest,
  type RunResponse,
  type RunTestResult,
  type RunVerdict,
} from '@/lib/compile';
import { consume, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import {
  SSE_HEADERS,
  encodeRunEvent,
  encodeSseComment,
  type BadgeAwardEvent,
  type RunEvent,
  type TestEventData,
  type VerdictEventData,
} from '@/lib/sse';
import { argumentsError } from '@/lib/client/signature';
import { prisma } from './db';
import { AccessDenied, DomainError, InvalidInput, NotFoundError, isDomainError } from './errors';
import { canAccessQuestion, whatsBlocking, type Blocker, type TopicRef } from './access';
import { assertGateSubmissionAllowed } from './gates';
import { completeSubmission, createSubmission, markSubmissionRunning, type TestOutcome } from './submissions';
import { onAcceptedSubmit } from './awards';
import type { AwardedBadge } from './badges';
import { sanitizeTestOutcome } from './rules/testResults';
import { codeByLanguageSchema, jsonValueSchema, parseJsonColumn, signatureSchema, testDefSchema } from './schemas';

/**
 * The judge pipeline behind POST /api/run and /api/submit (spec §3.2, §3.4,
 * §3.5, §4):
 *
 *   handleRunRequest     session → rate limit → body (zod, ≤ 64 KB source)
 *     prepareQuestionRun access (DomainErrors → HTTP before the stream
 *                        starts), tests, custom-input expectations
 *     runStreamResponse  text/event-stream with a heartbeat; aborts the
 *                        compile service when the browser goes away
 *       streamRun        createSubmission → markSubmissionRunning →
 *                        relay compile-service events (hidden tests stripped)
 *                        → completeSubmission → awards → `verdict`
 *
 * Hidden tests never leave the server with input / expected / actual, and
 * their error text is reduced to the error's kind — a program can print a
 * hidden input into its own exception message.
 */

// ─── Limits ──────────────────────────────────────────────────────────────

export const MAX_SOURCE_BYTES = 64 * 1024;
/** Whole request body: source + up to MAX_CUSTOM_INPUTS inputs. */
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_CUSTOM_INPUTS = 8;
const HEARTBEAT_MS = 15_000;
const REFERENCE_ORDER: readonly SupportedLanguage[] = ['python', 'javascript', 'typescript', 'go', 'cpp', 'java'];

// ─── Errors ──────────────────────────────────────────────────────────────

export interface LockedTopicBlocker {
  topic: TopicRef;
  /** null if it could not be computed (the lock itself still holds). */
  blocker: Blocker | null;
}

/** 403 for a question behind locked topics — carries what's blocking each, for a link to /map. */
export class QuestionLocked extends AccessDenied {
  constructor(
    readonly lockedTopics: TopicRef[],
    readonly blockers: LockedTopicBlocker[]
  ) {
    super('topic_locked', 'Unlock this question’s topics on the map first.');
    this.name = 'QuestionLocked';
  }
  toJSON() {
    return { ...super.toJSON(), lockedTopics: this.lockedTopics, blockers: this.blockers, mapUrl: '/map' };
  }
}

/** The compile service could not be reached (or refused the request). */
export class JudgeUnavailable extends DomainError {
  readonly code = 'judge_unavailable';
  readonly status = 503;
  constructor(message = 'The judge is unreachable right now. Try again in a moment.') {
    super(message);
    this.name = 'JudgeUnavailable';
  }
}

/** What's blocking each locked topic — for the 403 body and the locked page. */
export async function lockedTopicBlockers(userId: string, lockedTopics: TopicRef[]): Promise<LockedTopicBlocker[]> {
  return Promise.all(
    lockedTopics.map(async (topic) => ({
      topic,
      blocker: await whatsBlocking(userId, topic.id).catch(() => null),
    }))
  );
}

async function questionLocked(userId: string, lockedTopics: TopicRef[]): Promise<QuestionLocked> {
  return new QuestionLocked(lockedTopics, await lockedTopicBlockers(userId, lockedTopics));
}

// ─── Prepared runs ───────────────────────────────────────────────────────

/** One test of a run, as the server knows it (never sent as-is). */
export interface RunCase {
  hidden: boolean;
  input: unknown[];
  expected: unknown;
  explainOnFail?: string;
  /** Learner-added input; `expected` came from the reference solution. */
  custom?: boolean;
}

/** Everything checked and assembled — ready to persist and stream. */
export interface PreparedRun {
  userId: string;
  kind: SubmissionKind;
  language: SupportedLanguage;
  code: string;
  questionId: string;
  gateAttemptId: string | null;
  cases: RunCase[];
  request: RunRequest;
}

export interface QuestionRunInput {
  kind: 'run' | 'submit';
  questionId: string;
  language: SupportedLanguage;
  code: string;
  /** `run` only: extra argument lists, judged against the reference solution. */
  customInputs?: unknown[][];
  /** `submit` inside a gate attempt → a `gate` submission. */
  attemptId?: string;
}

export interface RunnerDeps {
  compile?: CompileClient;
  now?: Date;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function firstLine(text: string, max = 160): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The compile service's own 400 message (`{error}` in its JSON body), as one line. */
function judgeRejection(e: CompileServiceError): string {
  const body = e.message.replace(/^compile service \d+:\s*/, '');
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return firstLine(parsed.error);
  } catch {
    // truncated body — fall through
  }
  const m = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  return firstLine(m ? m[1] : body);
}

function isFetchFailure(e: unknown): boolean {
  return e instanceof TypeError && /fetch failed|network|ECONNREFUSED|ECONNRESET/i.test(`${e.message} ${String(e.cause ?? '')}`);
}

const testsSchema = z.array(testDefSchema);

function toCase(t: z.infer<typeof testDefSchema>): RunCase {
  return {
    hidden: t.hidden,
    input: t.input,
    expected: t.expected,
    ...(t.explain_on_fail ? { explainOnFail: t.explain_on_fail } : {}),
  };
}

/**
 * Expected values for learner-added inputs: the question's reference
 * solution (python first) run on them. An input the reference itself fails
 * on is not a valid input for the problem → InvalidInput (400).
 */
async function referenceOutputs(
  q: { slug: string; functionName: string; compareMode: 'ordered' | 'unordered'; referenceSolutions: unknown },
  signature: RunRequest['signature'],
  inputs: unknown[][],
  limits: RunRequest['limits'],
  client: CompileClient
): Promise<unknown[]> {
  const refs = parseJsonColumn(codeByLanguageSchema, q.referenceSolutions, `questions.reference_solutions (${q.slug})`);
  const language = REFERENCE_ORDER.find((l) => refs[l]?.trim());
  if (!language) {
    throw new InvalidInput('This question has no reference solution, so custom inputs can’t be checked. Run the samples instead.');
  }
  let res: RunResponse;
  try {
    res = await client.run({
      language,
      code: refs[language]!,
      functionName: q.functionName,
      signature,
      compareMode: q.compareMode,
      tests: inputs.map((input) => ({ input, expected: null })),
      limits,
    });
  } catch (e) {
    if (e instanceof CompileServiceError && e.status === 400) {
      throw new InvalidInput(`Those custom inputs don’t fit this problem: ${judgeRejection(e)}`);
    }
    throw new JudgeUnavailable();
  }
  if (res.status === 'CE' || res.status === 'XX' || res.tests.length !== inputs.length) {
    console.error(`[runner] reference solution for ${q.slug} failed: ${res.status} ${res.error ?? ''}`);
    throw new JudgeUnavailable('Custom inputs can’t be checked right now (the reference solution failed). Run the samples instead.');
  }
  res.tests.forEach((t, i) => {
    if (t.error) {
      throw new InvalidInput(
        `Custom case ${i + 1} isn’t a valid input for this problem — the reference solution failed on it (${firstLine(t.error, 120)}). Check it against the constraints.`
      );
    }
  });
  return res.tests.map((t) => t.actual);
}

/**
 * A question run (`run`: visible tests + custom inputs) or submission
 * (`submit`: every test). Throws NotFoundError, QuestionLocked /
 * AccessDenied, InvalidInput, JudgeUnavailable.
 */
export async function prepareQuestionRun(userId: string, input: QuestionRunInput, deps: RunnerDeps = {}): Promise<PreparedRun> {
  const now = deps.now ?? new Date();
  const q = await prisma.question.findUnique({
    where: { id: input.questionId },
    select: {
      id: true,
      slug: true,
      functionName: true,
      signature: true,
      compareMode: true,
      tests: true,
      referenceSolutions: true,
      timeLimitMs: true,
      memoryLimitMb: true,
    },
  });
  if (!q) throw new NotFoundError('question', input.questionId);

  let kind: SubmissionKind = input.kind;
  let gateAttemptId: string | null = null;
  if (input.kind === 'submit' && input.attemptId) {
    await assertGateSubmissionAllowed(userId, input.attemptId, q.id, now);
    kind = 'gate';
    gateAttemptId = input.attemptId;
  } else {
    const access = await canAccessQuestion(userId, q.id, now);
    if (!access.ok) {
      throw access.reason === 'topic_locked'
        ? await questionLocked(userId, access.lockedTopics)
        : new AccessDenied('draft', 'This question is not published.');
    }
    // Reachable only through a running gate attempt: a submit counts for the
    // gate (it must not earn the locked topics' tokens).
    if (input.kind === 'submit' && access.via === 'gate_attempt' && access.gateAttemptId) {
      kind = 'gate';
      gateAttemptId = access.gateAttemptId;
    }
  }

  const signature = parseJsonColumn(signatureSchema, q.signature, `questions.signature (${q.slug})`);
  const tests = parseJsonColumn(testsSchema, q.tests, `questions.tests (${q.slug})`);
  const limits = { timeMs: clamp(q.timeLimitMs, 100, 10_000), memoryMb: clamp(q.memoryLimitMb, 32, 512) };

  let cases: RunCase[];
  if (input.kind === 'run') {
    cases = tests.filter((t) => !t.hidden).map(toCase);
    const custom = input.customInputs ?? [];
    if (custom.length > MAX_CUSTOM_INPUTS) throw new InvalidInput(`At most ${MAX_CUSTOM_INPUTS} custom cases per run.`);
    custom.forEach((args, i) => {
      const err = argumentsError(signature, args, input.language);
      if (err) throw new InvalidInput(`Custom case ${i + 1}: ${err}`);
    });
    if (custom.length > 0) {
      const expected = await referenceOutputs(q, signature, custom, limits, deps.compile ?? defaultCompile);
      cases.push(...custom.map((args, i) => ({ hidden: false, input: args, expected: expected[i], custom: true })));
    }
    if (cases.length === 0) throw new InvalidInput('This question has no sample tests — add a custom case to run.');
  } else {
    cases = tests.map(toCase);
  }

  return {
    userId,
    kind,
    language: input.language,
    code: input.code,
    questionId: q.id,
    gateAttemptId,
    cases,
    request: {
      language: input.language,
      code: input.code,
      functionName: q.functionName,
      signature,
      compareMode: q.compareMode,
      tests: cases.map((c) => ({ input: c.input, expected: c.expected, hidden: c.hidden })),
      limits,
    },
  };
}

// ─── Redaction ───────────────────────────────────────────────────────────

const HIDDEN_NOTE = 'details are hidden for hidden tests';

/**
 * A hidden test's error, reduced to its kind: limits and "not run" pass
 * through; a runtime error keeps only its exception class name — never the
 * message, which the program controls.
 */
export function redactHiddenError(error: string): string {
  const e = error.trim();
  if (/^time limit exceeded/i.test(e)) return 'Time limit exceeded';
  if (/^memory limit exceeded/i.test(e)) return 'Memory limit exceeded';
  if (/^not run\b/i.test(e)) return 'Not run: the program stopped at an earlier test';
  const names = [...e.matchAll(/\b((?:[A-Z][A-Za-z0-9]*)?(?:Error|Exception))\b/g)].map((m) => m[1]);
  const name = names.find((n) => n !== 'Exception' && n !== 'Error') ?? names[0];
  if (name) return `${name} (${HIDDEN_NOTE})`;
  if (/\bpanic\b/.test(e)) return `panic (${HIDDEN_NOTE})`;
  return `Runtime error (${HIDDEN_NOTE})`;
}

/**
 * The verdict-level error of a crash is the program's stderr — which can
 * echo the test that was running. Keep it only when that test is visible.
 */
function verdictError(status: Verdict, error: string | undefined, outcomes: readonly TestOutcome[], cases: readonly RunCase[]) {
  if (!error) return undefined;
  if (status === 'CE' || status === 'XX' || status === 'OK') return error;
  if ((status === 'TLE' || status === 'MLE') && /^(time|memory) limit exceeded/i.test(error.trim())) return error;
  const stopped = outcomes.find((o) => !o.passed && o.error);
  const hiddenStop = stopped ? stopped.hidden : cases.some((c) => c.hidden);
  if (!hiddenStop) return error;
  return `${VERDICT_LABEL[status]} on a hidden test${stopped ? ` (test ${stopped.idx + 1})` : ''} — output from hidden tests isn’t shown.`;
}

function toOutcome(t: RunTestResult, cases: readonly RunCase[]): TestOutcome | null {
  const c = cases[t.idx];
  if (!c || !Number.isInteger(t.idx)) return null;
  const ran = t.runUs > 0 || !t.error;
  return {
    idx: t.idx,
    passed: t.passed === true,
    // Our own flag, not the echoed one.
    hidden: c.hidden,
    runtimeUs: ran ? t.runUs : null,
    // 0 means "not measured" (Java; C++ per test), never a real reading.
    memoryKb: t.memoryKb > 0 ? t.memoryKb : null,
    input: c.input,
    expected: c.expected,
    actual: t.actual,
    error: t.error ? (c.hidden ? redactHiddenError(t.error) : t.error) : null,
    explainOnFail: c.explainOnFail ?? null,
  };
}

function toTestEvent(o: TestOutcome, c: RunCase): TestEventData {
  const pub = sanitizeTestOutcome(o);
  return c.custom ? { ...pub, custom: true } : pub;
}

function slimBadge(b: AwardedBadge): BadgeAwardEvent {
  return { slug: b.slug, name: b.name, description: b.description, icon: b.icon, rarity: b.rarity };
}

// ─── Streaming ───────────────────────────────────────────────────────────

export type Emit = (event: RunEvent) => void;

/**
 * Persist and judge a prepared run, relaying the web protocol through
 * `emit`: queued → [compiling] → [running] → test… → verdict. Resolves with
 * the verdict (null when aborted: the submission is closed as XX
 * "Cancelled" and nothing more is emitted).
 */
export async function streamRun(
  run: PreparedRun,
  emit: Emit,
  opts: { signal?: AbortSignal; compile?: CompileClient } = {}
): Promise<VerdictEventData | null> {
  const client = opts.compile ?? defaultCompile;
  const { signal } = opts;
  const { id: submissionId } = await createSubmission({
    userId: run.userId,
    kind: run.kind,
    language: run.language,
    code: run.code,
    questionId: run.questionId,
    gateAttemptId: run.gateAttemptId,
  });
  emit({ event: 'queued', data: { submissionId, totalTests: run.cases.length } });

  const outcomes: Array<TestOutcome | undefined> = new Array(run.cases.length);
  let judged: RunVerdict | null = null;
  let failure: string | null = null;
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    await markSubmissionRunning(submissionId);
  };

  try {
    for await (const ev of client.runStream(run.request, signal)) {
      if (signal?.aborted) break;
      switch (ev.event) {
        case 'compiling':
        case 'running':
          await start();
          emit({ event: ev.event, data: {} });
          break;
        case 'test': {
          const outcome = toOutcome(ev.data, run.cases);
          if (!outcome) break;
          await start();
          outcomes[outcome.idx] = outcome;
          emit({ event: 'test', data: toTestEvent(outcome, run.cases[outcome.idx]) });
          break;
        }
        case 'verdict':
          judged = ev.data;
          break;
        case 'error':
          failure = ev.data?.message || 'The judge failed.';
          break;
        default:
          break; // the judge's own `queued`: already announced
      }
    }
  } catch (e) {
    if (!signal?.aborted) {
      console.error('[runner] compile stream failed:', e);
      failure =
        e instanceof CompileServiceError && e.status === 400
          ? `The judge rejected this run: ${judgeRejection(e)}`
          : 'The judge is unreachable right now. Try again in a moment.';
    }
  }

  const reported = outcomes.filter((o): o is TestOutcome => o !== undefined);
  if (signal?.aborted) {
    await completeSubmission(submissionId, { status: 'XX', tests: reported, error: 'Cancelled before the verdict.' }).catch((e) =>
      console.error('[runner] could not close a cancelled submission:', e)
    );
    return null;
  }

  let status: Verdict;
  let error: string | undefined;
  if (!judged || failure) {
    status = 'XX';
    error = failure ?? 'The judge stopped before a verdict.';
  } else {
    status = judged.status;
    error = judged.error;
    if (status !== 'CE' && status !== 'XX' && reported.length !== run.cases.length) {
      status = 'XX';
      error = 'The judge did not report every test.';
    }
  }
  // CE / XX verdicts never come with test results.
  const tests = status === 'CE' ? [] : reported;
  const completed = await completeSubmission(submissionId, {
    status,
    tests,
    compileMs: judged?.compileMs ?? null,
    error: verdictError(status, error, tests, run.cases) ?? null,
  });

  // Peak memory: C++ reports only the whole process's peak (on the verdict).
  let memoryKb = completed.memoryKb;
  const processKb = judged && judged.memoryKb > 0 ? Math.round(judged.memoryKb) : null;
  if (processKb != null && (memoryKb == null || processKb > memoryKb) && tests.length > 0) {
    memoryKb = processKb;
    await prisma.submission.update({ where: { id: submissionId }, data: { memoryKb } });
  }

  const verdict: VerdictEventData = {
    status: completed.status,
    totalPassed: completed.totalPassed,
    totalTests: run.cases.length,
    runtimeUs: completed.runtimeUs,
    memoryKb,
    ...(completed.compileMs != null ? { compileMs: completed.compileMs } : {}),
    submissionId,
    ...(completed.error ? { error: completed.error } : {}),
  };

  if (completed.status === 'OK' && (run.kind === 'submit' || run.kind === 'gate')) {
    try {
      const awards = await onAcceptedSubmit(run.userId, submissionId);
      verdict.tokensAwarded = awards.tokensAwarded;
      verdict.badgesAwarded = awards.badgesAwarded.map(slimBadge);
      if (run.kind === 'submit') verdict.percentile = awards.percentile;
    } catch (e) {
      // Awards are idempotent and never block the verdict.
      console.error('[runner] awarding failed:', e);
    }
  }

  emit({ event: 'verdict', data: verdict });
  return verdict;
}

/**
 * A text/event-stream Response for a prepared run: heartbeat comments every
 * ~15 s, and the compile-service stream aborted as soon as the browser goes
 * away (request signal or stream cancel).
 */
export function runStreamResponse(
  run: PreparedRun,
  requestSignal?: AbortSignal,
  opts: { compile?: CompileClient; heartbeatMs?: number } = {}
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const onRequestAbort = () => abort.abort();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      if (requestSignal?.aborted) abort.abort();
      else requestSignal?.addEventListener('abort', onRequestAbort, { once: true });
      heartbeat = setInterval(() => send(encodeSseComment('keep-alive')), opts.heartbeatMs ?? HEARTBEAT_MS);

      void streamRun(run, (e) => send(encodeRunEvent(e)), { signal: abort.signal, compile: opts.compile })
        .catch((e) => {
          console.error('[runner] run failed:', e);
          send(encodeRunEvent({ event: 'error', data: { message: 'Something went wrong while judging. Try again.' } }));
        })
        .finally(() => {
          clearInterval(heartbeat);
          requestSignal?.removeEventListener('abort', onRequestAbort);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already errored / cancelled
            }
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      abort.abort();
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

// ─── Route plumbing ──────────────────────────────────────────────────────

export type RunRoute = 'run' | 'submit';

const idSchema = z.string().trim().min(1).max(100);
const languageSchema = z.enum(LANGUAGES);

export const runBodySchema = z
  .object({
    questionId: idSchema,
    language: languageSchema,
    code: z.string(),
    customInputs: z.array(z.array(jsonValueSchema).max(20)).max(MAX_CUSTOM_INPUTS).optional(),
    attemptId: idSchema.optional(),
  })
  .strict();

export const submitBodySchema = z
  .object({
    questionId: idSchema,
    language: languageSchema,
    code: z.string(),
    attemptId: idSchema.optional(),
  })
  .strict();

function json(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

/** DomainError → its status; judge trouble → 503; anything else → 500. */
export function errorResponse(e: unknown): Response {
  if (isDomainError(e)) return json(e.status, e.toJSON());
  if (e instanceof CompileServiceError || isFetchFailure(e)) {
    return json(503, new JudgeUnavailable().toJSON());
  }
  console.error('[runner] unexpected error:', e);
  return json(500, { error: 'internal', message: 'Something went wrong. Try again.' });
}

/** Read at most `max` bytes of the body; null when it is larger. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const tooLarge = () =>
    json(413, { error: 'payload_too_large', message: `Requests are limited to ${MAX_BODY_BYTES / 1024} KB.` });
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return { ok: false, response: tooLarge() };
  const text = await readCapped(request, MAX_BODY_BYTES);
  if (text === null) return { ok: false, response: tooLarge() };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: json(400, { error: 'invalid_input', message: 'The request body must be JSON.' }) };
  }
}

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * The whole of POST /api/run | /api/submit: 401 without a user, 429 over the
 * shared per-user budget, 413 over 64 KB of source, 400/403/404/409 from
 * validation and the domain — all before the stream — then a
 * text/event-stream of RunEvents.
 */
export async function handleRunRequest(
  request: Request,
  route: RunRoute,
  userId: string | null | undefined,
  deps: RunnerDeps & { heartbeatMs?: number } = {}
): Promise<Response> {
  if (!userId) return json(401, { error: 'unauthorized', message: 'Sign in to run code.' });

  const limit = consume(`submit:${userId}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
  if (!limit.ok) {
    return json(
      429,
      {
        error: 'rate_limited',
        message: `You’re running code faster than the judge allows. Try again in ${limit.retryAfterSec} s.`,
        retryAfterSec: limit.retryAfterSec,
      },
      { 'Retry-After': String(limit.retryAfterSec) }
    );
  }

  const body = await readBody(request);
  if (!body.ok) return body.response;
  const schema = route === 'run' ? runBodySchema : submitBodySchema;
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return json(400, { error: 'invalid_input', message: zodMessage(parsed.error) });
  const input = parsed.data;

  if (new TextEncoder().encode(input.code).byteLength > MAX_SOURCE_BYTES) {
    return json(413, { error: 'source_too_large', message: `Source code is limited to ${MAX_SOURCE_BYTES / 1024} KB.` });
  }
  if (input.code.trim() === '') return json(400, { error: 'invalid_input', message: 'Write some code first.' });

  let prepared: PreparedRun;
  try {
    prepared = await prepareQuestionRun(userId, { kind: route, ...(input as z.infer<typeof runBodySchema>) }, deps);
  } catch (e) {
    return errorResponse(e);
  }
  return runStreamResponse(prepared, request.signal, deps);
}
