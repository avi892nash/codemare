import { SandboxStatus } from './types.js';

/**
 * Parsed isolate meta file. See `man isolate` for the field reference.
 * Fields are absent when not applicable (e.g. `cg-mem` only when `--cg` was passed).
 */
export interface IsolateMeta {
  /** User CPU time in seconds (decimal). */
  time?: number;
  /** Wall-clock time in seconds (decimal). */
  timeWall?: number;
  /** Peak cgroup memory usage in KB (when --cg used). */
  cgMem?: number;
  /** Peak resident set size in KB. */
  maxRss?: number;
  exitcode?: number;
  exitsig?: number;
  killed?: boolean;
  status?: 'TO' | 'SG' | 'RE' | 'XX';
  cgOomKilled?: boolean;
  message?: string;
}

const NUMERIC_FIELDS = new Set([
  'time',
  'time-wall',
  'cg-mem',
  'max-rss',
  'exitcode',
  'exitsig',
  'csw-voluntary',
  'csw-forced',
]);

const BOOLEAN_FIELDS = new Set(['killed', 'cg-oom-killed']);

/**
 * Parse the textual meta file produced by `isolate --meta=<file>`. The format is
 * `key:value`, one per line; values are numeric, boolean ("0"/"1"), or strings.
 * Unknown keys are ignored to stay forward-compatible with newer isolate versions.
 */
export function parseIsolateMeta(text: string): IsolateMeta {
  const meta: IsolateMeta = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'time':
        meta.time = Number(value);
        break;
      case 'time-wall':
        meta.timeWall = Number(value);
        break;
      case 'cg-mem':
        meta.cgMem = Number(value);
        break;
      case 'max-rss':
        meta.maxRss = Number(value);
        break;
      case 'exitcode':
        meta.exitcode = Number(value);
        break;
      case 'exitsig':
        meta.exitsig = Number(value);
        break;
      case 'killed':
        meta.killed = value === '1';
        break;
      case 'cg-oom-killed':
        meta.cgOomKilled = value === '1';
        break;
      case 'status':
        if (value === 'TO' || value === 'SG' || value === 'RE' || value === 'XX') {
          meta.status = value;
        }
        break;
      case 'message':
        meta.message = value;
        break;
      default:
        if (NUMERIC_FIELDS.has(key) || BOOLEAN_FIELDS.has(key)) {
          // Recognised but unused field — skip silently.
        }
        break;
    }
  }

  return meta;
}

/**
 * Translate an isolate meta into our outward-facing SandboxStatus. The mapping
 * accounts for OOM-kill being reported as either a TO with cg-oom-killed or an
 * SG with SIGKILL, depending on isolate version.
 */
export function mapMetaToStatus(meta: IsolateMeta): SandboxStatus {
  if (meta.cgOomKilled) return 'MLE';
  if (meta.status === 'TO') return 'TLE';
  if (meta.status === 'SG') return 'RE';
  if (meta.status === 'RE') return 'RE';
  if (meta.status === 'XX') return 'XX';
  if (typeof meta.exitcode === 'number' && meta.exitcode !== 0) return 'RE';
  return 'OK';
}
