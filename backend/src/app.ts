import express from 'express';
import cors from 'cors';
import problemRoutes from './routes/problemRoutes.js';
import executionRoutes from './routes/executionRoutes.js';
import ideRoutes from './routes/ideRoutes.js';
import queueRoutes from './routes/queueRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireInternalToken } from './middleware/internalAuth.js';

const app = express();

// CORS — only origins from ALLOWED_ORIGINS are accepted. Once Next.js is the
// only caller, this can be locked down to the Next.js origin (or removed if
// all traffic is server-to-server).
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173'];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-Codemare-Token'],
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Open: liveness probe for systemd / load balancer.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Authed: anything under /v1 (the frozen API surface) and /api (legacy alias).
// Both require X-Codemare-Token in production. The legacy /api/* mounts will be
// removed once the Next.js app is the only caller.
const authed = express.Router();
authed.use(requireInternalToken);
authed.use('/problems', problemRoutes);
authed.use('/execute', executionRoutes);
authed.use('/ide', ideRoutes);
authed.use('/queue', queueRoutes);

app.use('/v1', authed);
app.use('/api', authed);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
