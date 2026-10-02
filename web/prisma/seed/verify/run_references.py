#!/usr/bin/env python3
"""Run every reference solution against every test, in Python (python3) and
JavaScript (node), through harnesses that mirror the judge's comparison rules
(backend/src/services/codeWrapperService.ts): 'ordered' is plain equality
(Python ==, JavaScript JSON.stringify), 'unordered' sorts arrays recursively by
their JSON key before comparing (multiset equality).

    python3 web/prisma/seed/verify/run_references.py [--slow-ms 1000]

Covers the reference solutions of all 30 questions.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

from common import Report, load_questions

PY_HARNESS = r'''
import json as _cm_json
import sys as _cm_sys
import time as _cm_time

_CM_MODE = __MODE__

def _cm_canonical(v):
    if isinstance(v, list):
        return sorted((_cm_canonical(x) for x in v), key=lambda x: _cm_json.dumps(x, sort_keys=True))
    return v

def _cm_equal(actual, expected):
    if _CM_MODE == 'unordered':
        return _cm_canonical(actual) == _cm_canonical(expected)
    return actual == expected

_cm_out = []
for _cm_t in _cm_json.loads(_cm_sys.stdin.read()):
    _cm_t0 = _cm_time.perf_counter()
    try:
        _cm_r = __FN__(*_cm_t['input'])
        _cm_ms = (_cm_time.perf_counter() - _cm_t0) * 1000
        _cm_ok = _cm_equal(_cm_r, _cm_t['expected'])
        _cm_out.append({'passed': _cm_ok, 'ms': _cm_ms, 'actual': None if _cm_ok else _cm_r})
    except Exception as _cm_e:
        _cm_out.append({'passed': False, 'ms': 0, 'error': type(_cm_e).__name__ + ': ' + str(_cm_e)})
print(_cm_json.dumps(_cm_out))
'''

JS_HARNESS = r'''
const __cmMode = __MODE__;
function __cmCanonical(v) {
  if (Array.isArray(v)) {
    return v.map(__cmCanonical).sort((x, y) => {
      const kx = JSON.stringify(x), ky = JSON.stringify(y);
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
  }
  return v;
}
function __cmEqual(a, e) {
  if (__cmMode === 'unordered') return JSON.stringify(__cmCanonical(a)) === JSON.stringify(__cmCanonical(e));
  return JSON.stringify(a) === JSON.stringify(e);
}
const __cmTests = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const __cmOut = [];
for (const t of __cmTests) {
  const t0 = process.hrtime.bigint();
  try {
    const r = __FN__(...t.input);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const ok = __cmEqual(r, t.expected);
    __cmOut.push({ passed: ok, ms, actual: ok ? null : (r === undefined ? null : r) });
  } catch (e) {
    __cmOut.push({ passed: false, ms: 0, error: String(e && e.stack || e) });
  }
}
console.log(JSON.stringify(__cmOut));
'''


def run_suite(lang, source, fn, mode, tests, workdir, label):
    """Run `tests` against `source`. Returns (label, lang, results | error string)."""
    body = source
    if lang == 'python':
        program = body + '\n' + PY_HARNESS.replace('__MODE__', repr(mode)).replace('__FN__', fn)
        path = os.path.join(workdir, f'{label}.py')
        cmd = [sys.executable, path]
    else:
        program = body + '\n' + JS_HARNESS.replace('__MODE__', json.dumps(mode)).replace('__FN__', fn)
        path = os.path.join(workdir, f'{label}.js')
        cmd = ['node', '--stack-size=65500', path]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(program)
    payload = json.dumps([{'input': t['input'], 'expected': t['expected']} for t in tests])
    try:
        res = subprocess.run(cmd, input=payload, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return label, lang, 'timed out after 300 s'
    if res.returncode != 0:
        return label, lang, f'exit {res.returncode}: {res.stderr.strip()[-2000:]}'
    try:
        return label, lang, json.loads(res.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return label, lang, f'unparseable output: {res.stdout[-500:]!r} {res.stderr[-500:]!r}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--slow-ms', type=float, default=1000.0, help='warn when a single test takes longer than this')
    args = ap.parse_args()

    r = Report('references')
    questions = load_questions()

    jobs = []  # (label, lang, source, fn, mode, tests)
    for _, q in questions:
        for lang in ('python', 'javascript'):
            jobs.append((f'q-{q["slug"]}', lang, q['reference_solutions'][lang], q['function_name'],
                         q['compare_mode'], q['tests']))

    totals = {'python': [0, 0], 'javascript': [0, 0]}
    with tempfile.TemporaryDirectory(prefix='seed-refs-') as workdir:
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            futures = [pool.submit(run_suite, lang, source, fn, mode, tests, workdir, f'{label}-{lang}')
                       for label, lang, source, fn, mode, tests in jobs]
            results = [f.result() for f in futures]
    for (label, lang, source, fn, mode, tests), (_, _, out) in zip(jobs, results):
        where = f'{label} [{lang}]'
        if isinstance(out, str):
            r.error(where, out)
            continue
        if len(out) != len(tests):
            r.error(where, f'{len(out)} results for {len(tests)} tests')
            continue
        slowest = 0.0
        for i, (t, res) in enumerate(zip(tests, out)):
            totals[lang][1] += 1
            slowest = max(slowest, res.get('ms', 0))
            if res['passed']:
                totals[lang][0] += 1
            else:
                detail = res.get('error') or f'got {json.dumps(res.get("actual"))[:200]}, expected {json.dumps(t["expected"])[:200]}'
                r.error(where, f'test {i} failed: {detail}')
        if slowest > args.slow_ms:
            r.warn(where, f'slowest test took {slowest:.0f} ms')

    for lang, (ok, total) in totals.items():
        print(f'{lang}: {ok}/{total} tests passed')
    return 0 if r.print() else 1


if __name__ == '__main__':
    sys.exit(main())
