// `npm test` runs this first (the "pretest" script). The test files run in
// parallel and several of them build Go; on a cold cache (a fresh CI runner)
// each would otherwise recompile the standard library at the same time and
// could crowd the 15 s compile limit. Warming once up front — exactly as the
// server does at startup — keeps those builds fast and deterministic. A no-op
// when Go isn't installed.
import { warmGoBuildCache } from '../../src/services/sandbox/goToolchain.js';

console.log(`go build cache: ${await warmGoBuildCache()}`);
