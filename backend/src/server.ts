import app from './app.js';
import { sandboxReadinessProbe } from './services/sandboxService.js';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const probe = await sandboxReadinessProbe();
    console.log('Sandbox: isolate');
    console.log(`  Available: ${probe.available.join(', ') || 'none'}`);
    if (probe.unavailable.length > 0) {
      for (const u of probe.unavailable) {
        console.warn(`  Unavailable: ${u.language} (${u.reason})`);
      }
    }

    app.listen(PORT, () => {
      console.log(`\nCodemare backend running on http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   API Endpoints:`);
      console.log(`     GET  /api/problems`);
      console.log(`     GET  /api/problems/:id`);
      console.log(`     POST /api/execute\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
