import app from './app.js';
import { sandboxReadinessProbe } from './services/sandboxService.js';
import { isQueueEnabled, startWorker, QUEUE_INFO } from './queue/queue.js';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const probe = await sandboxReadinessProbe();
    console.log(`Sandbox: ${probe.backend}`);
    console.log(`  Available: ${probe.available.join(', ') || 'none'}`);
    if (probe.unavailable.length > 0) {
      for (const u of probe.unavailable) {
        console.warn(`  Unavailable: ${u.language} (${u.reason})`);
      }
    }

    // Queue mode: with REDIS_URL set, submissions can be enqueued and polled.
    // Without it, the API runs every submission synchronously (unchanged).
    if (isQueueEnabled()) {
      console.log(`Queue: enabled (${QUEUE_INFO.name})`);
      // A single VM can run the API and a worker in one process via
      // WORKER_INLINE=true. For real horizontal scale, leave this unset and
      // run separate `npm run worker` processes pointed at the same Redis.
      if (process.env.WORKER_INLINE === 'true') {
        startWorker();
        console.log(`  Inline worker: on (concurrency ${QUEUE_INFO.workerConcurrency})`);
      } else {
        console.log('  Inline worker: off — run `npm run worker` separately');
      }
    } else {
      console.log('Queue: disabled (REDIS_URL unset) — synchronous execution');
    }

    app.listen(PORT, () => {
      console.log(`\nCodemare backend running on http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   API Endpoints:`);
      console.log(`     GET  /v1/problems`);
      console.log(`     POST /v1/execute        (?wait=true for sync)`);
      console.log(`     GET  /v1/execute/:token (poll async)\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
