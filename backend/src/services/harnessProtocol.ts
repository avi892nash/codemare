/**
 * Wire protocol between the generated test harnesses and this service.
 *
 * Every harness (python / javascript / cpp / java / go) writes one line per
 * test to stdout — as soon as that test finishes, flushed — then one summary
 * line:
 *
 *   \x1eCMR:{"i":0,"output":[0,1],"runNs":1200,"wallNs":1500,"peakBytes":64}
 *   \x1eCMR:{"i":1,"error":"ZeroDivisionError: division by zero"}
 *   \x1eCMR:{"done":true,"totalRunNs":1200,"peakBytes":64}
 *
 * The typed/legacy harnesses also echo "expected" and their own "passed";
 * both are informational — the service always re-compares `output` against
 * the expected value it holds (decision 12: the harness is never trusted).
 * A wrapper-declared platform failure puts "error" on the summary line.
 *
 * Why lines with a marker instead of one JSON document at exit:
 *   · the learner's own prints share stdout — anything without the marker is
 *     user output and can't break result parsing;
 *   · a run killed mid-way (TLE / MLE / crash) still yields the results of
 *     the tests that finished, so a verdict can say which test it died on;
 *   · the local adapter can stream records while the program runs.
 * The marker starts with ASCII RS (0x1e) so ordinary output never collides by
 * accident. A deliberate forgery gains nothing: outputs are compared against
 * expected values that — for the dynamic languages — never enter the box.
 */

export const HARNESS_MARK = '\x1eCMR:';

export interface HarnessTestRecord {
  i: number;
  output?: unknown;
  /** Legacy echo from the older harnesses; not used for judging /v1/run. */
  expected?: unknown;
  /** Legacy harness-side verdict; not used for judging. */
  passed?: boolean;
  error?: string;
  runNs?: number;
  wallNs?: number;
  peakBytes?: number;
}

export interface HarnessSummary {
  totalRunNs?: number;
  peakBytes?: number;
  error?: string;
}

export interface ParsedHarnessOutput {
  /** First record per test index wins. */
  tests: Map<number, HarnessTestRecord>;
  /** Present only when the harness ran to completion. */
  summary?: HarnessSummary;
  /** Everything on stdout that is not a harness record (the user's prints). */
  userOutput: string;
}

type Record_ = { kind: 'test'; test: HarnessTestRecord } | { kind: 'done'; summary: HarnessSummary };

function finiteNonNegative(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function parseRecord(json: string): Record_ | undefined {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.done === true) {
    return {
      kind: 'done',
      summary: {
        totalRunNs: finiteNonNegative(obj.totalRunNs),
        peakBytes: finiteNonNegative(obj.peakBytes),
        error: typeof obj.error === 'string' ? obj.error : undefined,
      },
    };
  }
  if (typeof obj.i !== 'number' || !Number.isSafeInteger(obj.i) || obj.i < 0) return undefined;
  return {
    kind: 'test',
    test: {
      i: obj.i,
      output: obj.output,
      expected: obj.expected,
      passed: typeof obj.passed === 'boolean' ? obj.passed : undefined,
      error: typeof obj.error === 'string' ? obj.error : undefined,
      runNs: finiteNonNegative(obj.runNs),
      wallNs: finiteNonNegative(obj.wallNs),
      peakBytes: finiteNonNegative(obj.peakBytes),
    },
  };
}

/**
 * Splits text into harness records and user output. `final` says whether
 * the text is complete: when it isn't, a trailing record without its newline
 * is left unconsumed (returned as `rest`) so a later chunk can finish it.
 */
function scan(
  text: string,
  final: boolean
): { records: Record_[]; userOutput: string; rest: string } {
  const records: Record_[] = [];
  let userOutput = '';
  let pos = 0;
  for (;;) {
    const mark = text.indexOf(HARNESS_MARK, pos);
    if (mark < 0) {
      if (final) {
        userOutput += text.slice(pos);
        return { records, userOutput, rest: '' };
      }
      // Keep a possible partial marker at the very end for the next chunk.
      const keep = partialMarkSuffix(text, pos);
      userOutput += text.slice(pos, text.length - keep);
      return { records, userOutput, rest: text.slice(text.length - keep) };
    }
    userOutput += text.slice(pos, mark);
    const start = mark + HARNESS_MARK.length;
    const nl = text.indexOf('\n', start);
    if (nl < 0) {
      if (!final) return { records, userOutput, rest: text.slice(mark) };
      // Final text: a record cut off by a kill is kept only if it parses.
      const rec = parseRecord(text.slice(start));
      if (rec) records.push(rec);
      return { records, userOutput, rest: '' };
    }
    const rec = parseRecord(text.slice(start, nl));
    if (rec) records.push(rec);
    pos = nl + 1;
  }
}

/** Length of the longest suffix of text[from..] that is a prefix of the mark. */
function partialMarkSuffix(text: string, from: number): number {
  const max = Math.min(HARNESS_MARK.length - 1, text.length - from);
  for (let n = max; n > 0; n--) {
    if (HARNESS_MARK.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

function collect(records: Record_[], into: ParsedHarnessOutput): void {
  for (const r of records) {
    if (r.kind === 'done') {
      if (!into.summary) into.summary = r.summary;
    } else if (!into.tests.has(r.test.i)) {
      into.tests.set(r.test.i, r.test);
    }
  }
}

/** Parse a harness's complete stdout. */
export function parseHarnessOutput(stdout: string): ParsedHarnessOutput {
  const out: ParsedHarnessOutput = { tests: new Map(), userOutput: '' };
  const { records, userOutput } = scan(stdout, true);
  collect(records, out);
  out.userOutput = userOutput;
  return out;
}

/**
 * Incremental parser for live stdout. `push` returns the test records that
 * became complete with this chunk (first record per index only — the same
 * rule parseHarnessOutput applies, so streamed and final results agree).
 */
export class HarnessStreamParser {
  private buffer = '';
  private readonly seen = new Set<number>();

  push(chunk: string): HarnessTestRecord[] {
    const { records, rest } = scan(this.buffer + chunk, false);
    this.buffer = rest;
    const fresh: HarnessTestRecord[] = [];
    for (const r of records) {
      if (r.kind === 'test' && !this.seen.has(r.test.i)) {
        this.seen.add(r.test.i);
        fresh.push(r.test);
      }
    }
    return fresh;
  }
}
