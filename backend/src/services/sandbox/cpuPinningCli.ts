/**
 * Prints isolate config lines that make the service's CPU plan binding: one
 * cgroup cpuset per box (`box<N>.cpus = …`), for the run and compile box ids
 * the isolate adapter uses. The container entrypoint appends them to
 * /usr/local/etc/isolate before the server starts (only root may write that
 * file, and only isolate — setuid root — may set a box's cpuset):
 *
 *   node dist/services/sandbox/cpuPinningCli.js <num_boxes>
 *
 * The plan comes from cpuPinning.ts — the same code the adapter pins with —
 * and this process has the same CPU affinity the server will have. Prints
 * only comments when ISOLATE_CPU_PINNING=off. Exits non-zero, with the reason
 * on stderr, when the plan cannot be made.
 */
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { boxIdRanges, describePlan, isolateCpusetLines, planCpus, readAllowedCpus } from './cpuPinning.js';

function main(): number {
  const numBoxes = Number(process.argv[2]);
  const { maxBoxes, compileBoxes, cpuPinning } = SANDBOX_CONFIG.isolate;
  if (!Number.isInteger(numBoxes) || numBoxes < 1) {
    console.error('usage: cpuPinningCli.js <isolate num_boxes>');
    return 2;
  }
  if (maxBoxes + compileBoxes > numBoxes) {
    console.error(
      `isolate num_boxes=${numBoxes} is too small: the service uses box ids 0-${maxBoxes + compileBoxes - 1}`
    );
    return 1;
  }
  if (cpuPinning === 'off') {
    console.log('# ISOLATE_CPU_PINNING=off: no per-box cpusets');
    return 0;
  }
  const cpus = readAllowedCpus();
  if (!cpus) {
    console.error('cannot read this process\'s CPUs (Cpus_allowed_list in /proc/self/status)');
    return 1;
  }
  const plan = planCpus(cpus);
  const ids = boxIdRanges(maxBoxes, compileBoxes);
  console.log(`# CPU plan (backend/src/services/sandbox/cpuPinning.ts): ${describePlan(plan)}`);
  for (const line of isolateCpusetLines(plan, ids.run, ids.compile)) console.log(line);
  return 0;
}

process.exitCode = main();
