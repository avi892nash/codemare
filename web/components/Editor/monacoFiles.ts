/**
 * The files of Monaco (monaco-editor 0.55.1, the version @monaco-editor/loader
 * names, from jsDelivr) that the editor asks for when a problem opens, as the
 * loader requests them for the six judge languages. The map prefetches them
 * (EditorPrefetch) so a learner's first problem finds them in the cache.
 *
 * After a version bump the names go stale: a 404 costs nothing, but the warm-up
 * stops working — e2e/editor.spec.ts compares this list with what a cold problem
 * page really asks for, and fails on any that is missing. To list them again:
 * open a problem on a cold cache and read the requests to cdn.jsdelivr.net.
 */
const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/';

export const MONACO_FILES: readonly string[] = [
  'loader.js',
  'editor/editor.main.js',
  'editor/editor.main.css',
  'nls.messages-loader.js',
  'monaco.contribution-DO3azKX8.js',
  'monaco.contribution-qLAYrEOP.js',
  'monaco.contribution-EcChJV6a.js',
  'monaco.contribution-D2OdxNBt.js',
  'basic-languages/monaco.contribution.js',
  'editor.api-CalNCsUg.js',
  'workers-DcJshg-q.js',
  'assets/editor.worker-Be8ye1pW.js',
  'python-Cr0UkIbn.js',
  'javascript-PczUCGdz.js',
  'typescript-DfOrAzoV.js',
  'java-CI4ZMsH9.js',
  'cpp-CkKPQIni.js',
  'go-D_hbi-Jt.js',
].map((f) => BASE + f);
