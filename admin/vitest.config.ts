import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same `@/` → web/ mapping the extension build uses (extension.config.js).
const webRoot = fileURLToPath(new URL('../web/', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${webRoot}$1` }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
