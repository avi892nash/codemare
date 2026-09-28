import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import { IsolateMeta, mapMetaToStatus } from './metaParser.js';
import { SandboxResult } from './types.js';

/**
 * Reading what a box wrote, and turning a run's meta file into a result.
 *
 * Everything in a box directory was written by the learner's program, which
 * can replace its own stdout file. isolate unlinks symlinks and other
 * special files when the run ends, but the service does not rely on that:
 * it opens box files with O_NOFOLLOW, reads regular files only, and never
 * more than a fixed budget — isolate's --fsize caps what the program can
 * write, and these caps what the service holds in memory.
 */

export interface BoxFileRead {
  /** Decoded text, at most the read budget (plus an omission marker). */
  text: string;
  /** The file's size on disk. */
  size: number;
}

const EMPTY: BoxFileRead = { text: '', size: 0 };

async function openBoxFile(file: string): Promise<{ handle: FileHandle; size: number } | null> {
  let handle: FileHandle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    return null; // missing, or a symlink (ELOOP)
  }
  const st = await handle.stat().catch(() => null);
  if (!st?.isFile()) {
    await handle.close();
    return null;
  }
  return { handle, size: st.size };
}

async function readRange(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await handle.read(buf, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return buf.subarray(0, done);
}

/** The first `maxBytes` of a box file (a program's stdout). */
export async function readBoxFile(file: string, maxBytes: number): Promise<BoxFileRead> {
  const f = await openBoxFile(file);
  if (!f) return EMPTY;
  try {
    const buf = await readRange(f.handle, 0, Math.min(f.size, maxBytes));
    return { text: buf.toString('utf8'), size: f.size };
  } finally {
    await f.handle.close();
  }
}

/**
 * A box file within `maxBytes`: whole when it fits, otherwise its first and
 * last halves around an omission marker. For stderr, where the reason for a
 * crash is at the top (Go, Java, C++, Node, compilers) or at the bottom
 * (Python's traceback).
 */
export async function readBoxFileHeadTail(file: string, maxBytes: number): Promise<BoxFileRead> {
  const f = await openBoxFile(file);
  if (!f) return EMPTY;
  try {
    if (f.size <= maxBytes) {
      return { text: (await readRange(f.handle, 0, f.size)).toString('utf8'), size: f.size };
    }
    const half = Math.floor(maxBytes / 2);
    const head = await readRange(f.handle, 0, half);
    const tail = await readRange(f.handle, f.size - half, half);
    const omitted = f.size - 2 * half;
    return {
      text: `${head.toString('utf8')}\n… (${omitted} bytes omitted) …\n${tail.toString('utf8')}`,
      size: f.size,
    };
  } finally {
    await f.handle.close();
  }
}

/** Signal a process gets when it writes past RLIMIT_FSIZE (25 on Linux). */
export const SIGXFSZ: number = os.constants.signals.SIGXFSZ ?? 25;

export function outputLimitMessage(capBytes: number): string {
  return `Output limit exceeded (${Math.round(capBytes / (1024 * 1024))} MB)`;
}

/**
 * Did the program hit the file-size cap? Runtimes react differently: C++
 * dies of SIGXFSZ; Python, Node, Java and Go ignore the signal and get EFBIG
 * — Python exits with an error, Java's PrintStream and Go's fmt swallow it and
 * keep looping until TLE, and Node queued output until it was OOM-killed. A
 * stream that reached the cap is therefore the signal that counts, whatever
 * isolate's own status says.
 */
export function outputLimitHit(
  meta: IsolateMeta,
  stdoutSize: number,
  stderrSize: number,
  capBytes: number
): boolean {
  return meta.exitsig === SIGXFSZ || stdoutSize >= capBytes || stderrSize >= capBytes;
}

/** SandboxResult of a run box, from its meta file and captured streams. */
export function runBoxResult(input: {
  meta: IsolateMeta;
  stdout: BoxFileRead;
  stderr: BoxFileRead;
  timeoutMs: number;
  memoryKb: number;
  outputCapBytes: number;
  compileMs?: number;
}): SandboxResult {
  const { meta, stdout, stderr } = input;
  const overflow = outputLimitHit(meta, stdout.size, stderr.size, input.outputCapBytes);
  const status = overflow ? 'RE' : mapMetaToStatus(meta);
  let error: string | undefined;
  if (overflow) error = outputLimitMessage(input.outputCapBytes);
  else if (status === 'TLE') error = `Time limit exceeded (${input.timeoutMs} ms)`;
  else if (status === 'MLE') error = `Memory limit exceeded (${Math.round(input.memoryKb / 1024)} MB)`;
  else if (status !== 'OK') error = stderr.text.trim() || meta.message;
  return {
    output: stdout.text,
    error,
    status,
    runMs: (meta.time ?? 0) * 1000,
    wallMs: (meta.timeWall ?? meta.time ?? 0) * 1000,
    memoryKb: meta.cgMem ?? meta.maxRss ?? 0,
    compileMs: input.compileMs,
    exitCode: meta.exitcode,
  };
}
