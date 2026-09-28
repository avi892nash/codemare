// Build config for `directus-extension build` (run from this directory).
//
// The recipe editor and the hooks reuse the web app's pure token rules
// (web/lib/server/rules/{recipes,scoring}.ts, web/lib/types.ts) instead of
// re-implementing them: architecture §3 keeps every rule in one place. Those
// files import each other through the web app's `@/` path alias, which this
// maps onto ../../../web so rollup can bundle them into dist/.
import { fileURLToPath } from 'node:url';
import alias from '@rollup/plugin-alias';

const webRoot = fileURLToPath(new URL('../../../web/', import.meta.url));

export default {
  plugins: [
    alias({
      entries: [{ find: /^@\/(.*)$/, replacement: `${webRoot}$1.ts` }],
    }),
  ],
};
