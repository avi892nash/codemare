import app from './app.js';
import { checkDockerImages } from './services/dockerService.js';

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Check if Docker images are available
    const { available, missing } = await checkDockerImages();

    console.log('Docker Images Status:');
    console.log('  Available:', available.join(', ') || 'none');
    if (missing.length > 0) {
      console.warn('  Missing:', missing.join(', '));
      console.warn('  Please build missing images with: docker-compose build');
    }

    // Start server
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
