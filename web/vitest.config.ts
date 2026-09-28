import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './lib/server/test/database-url';

/**
 * Unit tests (vitest). Pure rule tests need nothing; DB tests run against a
 * dedicated test database (see lib/server/test/database-url.ts) that the
 * global setup creates if missing and migrates, and that each DB test file
 * truncates between tests (lib/server/test/db.ts).
 */
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': root,
      // `import 'server-only'` throws outside a React Server Components build.
      'server-only': `${root}lib/server/test/server-only.ts`,
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'prisma/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['lib/server/test/global-setup.ts'],
    // One shared database: run files one after another.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      DATABASE_URL: testDatabaseUrl(root),
    },
  },
});
