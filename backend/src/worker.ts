import { isQueueEnabled, startWorker, QUEUE_INFO } from './queue/queue.js';
import { sandboxReadinessProbe } from './services/sandboxService.js';

/**
 * Standalone worker process. Run one or more of these (each its own VM /
 * container / process) pointed at the same REDIS_URL to scale execution
 * horizontally and independently of the API.
 *
 *   npm run worker
 *
 * Each worker runs the same sandbox stack as the API (isolate in prod), so a
 * worker host needs isolate + the language toolchains installed just like an
 * API host. The API host can run with no workers at all if it only serves the
 * synchronous `?wait=true` path.
 */
async function main() {
  if (!isQueueEnabled()) {
    console.error(
      'worker: REDIS_URL is not set. The worker needs a queue to drain.\n' +
        '        Set REDIS_URL and retry, or run the API in synchronous mode.'
    );
    process.exit(1);
  }

  const probe = await sandboxReadinessProbe();
  console.log(`worker: sandbox=${probe.backend} languages=${probe.available.join(', ') || 'none'}`);
  if (probe.unavailable.length > 0) {
    for (const u of probe.unavailable) {
      console.warn(`  unavailable: ${u.language} (${u.reason})`);
    }
  }

  const worker = startWorker();
  console.log(
    `worker: draining "${QUEUE_INFO.name}" with concurrency ${QUEUE_INFO.workerConcurrency}`
  );

  const shutdown = async (sig: string) => {
    console.log(`worker: ${sig} received, closing…`);
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('worker: fatal —', err);
  process.exit(1);
});
