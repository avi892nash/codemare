import { randomUUID } from 'node:crypto';
import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { ExecutionRequest, ExecutionResponse } from '../models/ExecutionResult.js';
import { IdeExecutionRequest, IdeExecutionResponse } from '../models/IdeExecution.js';
import { Problem } from '../models/Problem.js';
import { executeCode } from '../services/executionService.js';
import { executeIdeCode } from '../services/ideExecutionService.js';
import { sanitizeResults } from '../services/validationService.js';

/**
 * Optional Redis-backed job queue (BullMQ).
 *
 * Gated entirely on REDIS_URL: with it unset, isQueueEnabled() is false and
 * the controllers run synchronously exactly as before — dev and the current
 * single-node prod need no Redis. With it set, submissions can be enqueued
 * (returning a token) and processed by one or more worker processes, which is
 * what lets execution scale independently of the API under burst load.
 *
 * Result storage uses BullMQ's own completed-job retention (returnvalue kept
 * for RESULT_TTL_SEC), so we don't run a second result store.
 */

const REDIS_URL = process.env.REDIS_URL?.trim() ?? '';
const QUEUE_NAME = 'codemare-submissions';
const RESULT_TTL_SEC = Number(process.env.QUEUE_RESULT_TTL_SEC ?? 3600);
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);

export type JobPayload =
  | { kind: 'execute'; request: ExecutionRequest; problem: Problem }
  | { kind: 'ide'; request: IdeExecutionRequest };

export type JobResult = ExecutionResponse | IdeExecutionResponse;

export type PollResult =
  | { state: 'pending' }
  | { state: 'done'; result: JobResult }
  | { state: 'error'; error: string }
  | { state: 'not_found' };

export function isQueueEnabled(): boolean {
  return REDIS_URL !== '';
}

// ── Connection ────────────────────────────────────────────────────────────
// Parse REDIS_URL into options and let BullMQ own the connection (it bundles
// its own ioredis; passing a foreign instance triggers a dual-package type
// clash). Each Queue/Worker gets its own connection, which BullMQ recommends.
function connectionOptions(): ConnectionOptions {
  const u = new URL(REDIS_URL);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ.
    maxRetriesPerRequest: null,
  };
}

// ── Lazy queue singleton — created only when REDIS_URL is set ─────────────
let queue: Queue<JobPayload, JobResult> | null = null;

function getQueue(): Queue<JobPayload, JobResult> {
  if (!queue) {
    queue = new Queue<JobPayload, JobResult>(QUEUE_NAME, {
      connection: connectionOptions(),
      defaultJobOptions: {
        attempts: 1, // user code; never retry a submission
        removeOnComplete: { age: RESULT_TTL_SEC },
        removeOnFail: { age: RESULT_TTL_SEC },
      },
    });
  }
  return queue;
}

/** Enqueue a submission. Returns the token the client polls with. */
export async function enqueue(payload: JobPayload): Promise<string> {
  if (!isQueueEnabled()) {
    throw new Error('Queue is disabled (REDIS_URL unset)');
  }
  const token = randomUUID();
  await getQueue().add(payload.kind, payload, { jobId: token });
  return token;
}

export interface QueueStats {
  enabled: boolean;
  name?: string;
  workerConcurrency?: number;
  resultTtlSec?: number;
  counts?: Record<string, number>;
}

/**
 * Live queue depth for tuning/observability: how many jobs are waiting,
 * active, completed, failed, delayed right now. Cheap — a single Redis call.
 * Returns { enabled: false } when the queue is off.
 */
export async function getQueueStats(): Promise<QueueStats> {
  if (!isQueueEnabled()) return { enabled: false };
  const counts = await getQueue().getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed'
  );
  return {
    enabled: true,
    name: QUEUE_NAME,
    workerConcurrency: WORKER_CONCURRENCY,
    resultTtlSec: RESULT_TTL_SEC,
    counts,
  };
}

/** Poll for a job's result by token. */
export async function getResult(token: string): Promise<PollResult> {
  if (!isQueueEnabled()) {
    return { state: 'not_found' };
  }
  const job = await getQueue().getJob(token);
  if (!job) return { state: 'not_found' };

  const state = await job.getState();
  if (state === 'completed') {
    return { state: 'done', result: job.returnvalue as JobResult };
  }
  if (state === 'failed') {
    return { state: 'error', error: job.failedReason ?? 'Execution failed' };
  }
  // waiting | active | delayed | paused | waiting-children
  return { state: 'pending' };
}

/**
 * Run the actual job. Shared by both the standalone worker and the optional
 * in-process worker. Returns the sanitized response stored as the job result.
 */
async function processJob(job: Job<JobPayload, JobResult>): Promise<JobResult> {
  const payload = job.data;
  if (payload.kind === 'execute') {
    const result = await executeCode(payload.request, payload.problem);
    return { ...result, testResults: sanitizeResults(result.testResults) };
  }
  return executeIdeCode(payload.request);
}

/**
 * Start a BullMQ worker that drains the queue. Used by the standalone
 * `worker.ts` entrypoint and, when WORKER_INLINE=true, by the API process so a
 * single VM can run both without a separate process.
 */
export function startWorker(): Worker<JobPayload, JobResult> {
  if (!isQueueEnabled()) {
    throw new Error('Cannot start worker: REDIS_URL unset');
  }
  const worker = new Worker<JobPayload, JobResult>(QUEUE_NAME, processJob, {
    connection: connectionOptions(),
    concurrency: WORKER_CONCURRENCY,
  });
  worker.on('failed', (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });
  return worker;
}

export const QUEUE_INFO = {
  name: QUEUE_NAME,
  resultTtlSec: RESULT_TTL_SEC,
  workerConcurrency: WORKER_CONCURRENCY,
};
