#!/usr/bin/env node
// Isolate smoke: the production sandbox path end to end, against a running
// compile-service container (backend/Dockerfile, privileged, as in
// docker-compose.prod.yml). No dependencies beyond Node 20.
//
//   INTERNAL_TOKEN=… node backend/tests/isolate/smoke.mjs [base-url]
//
// Covers every language through POST /v1/run and POST /v1/ide/execute, the
// verdicts (OK, WA, CE with learner line numbers, TLE, MLE, RE), a cached
// recompile, and containment: PID cap, memory cap, output cap, no network,
// no host files, a read-only filesystem outside /box and /tmp, one CPU per
// run box even for a program that tries to widen its affinity, and the
// strict syscall filter in a Go run box (only its compile box may lock
// files). Exits 1 if any check fails. Used by CI (.github/workflows/ci.yml,
// job backend-isolate) and for local verification.

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4600').replace(/\/$/, '');
const HEADERS = { 'Content-Type': 'application/json', 'X-Codemare-Token': process.env.INTERNAL_TOKEN ?? '' };

async function request(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
const post = async (path, body) => JSON.parse(await request(path, body));

const SIG = { params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]' };
const TESTS = [
  { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
  { input: [[3, 2, 4], 6], expected: [1, 2] },
  { input: [[3, 3], 6], expected: [0, 1], hidden: true },
];
const run = (language, code, limits) =>
  post('/v1/run', { language, code, functionName: 'twoSum', signature: SIG, compareMode: 'unordered', tests: TESTS, ...(limits ? { limits } : {}) });

/** One stdin/stdout program through /v1/ide/execute; resolves to its test result. */
const ide = async (language, code, input = '', expectedOutput = '') =>
  (await post('/v1/ide/execute?wait=true', { language, code, testCases: [{ input, expectedOutput }] })).testResults[0];
/** The program exited cleanly (WA only means its output differs from the expected one). */
const exited = (t) => t.status === 'OK' || t.status === 'WA';

/** Event names of a POST /v1/run/stream response. */
async function streamEvents(language, code) {
  const text = await request('/v1/run/stream', { language, code, functionName: 'twoSum', signature: SIG, compareMode: 'unordered', tests: TESTS });
  return [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
}

// ── solutions, written the way the starter code is (web seed data) ─────────

const TWO_SUM = {
  python: 'def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n',
  javascript: 'function twoSum(nums, target) {\n  const seen = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n',
  typescript: 'function twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const j = seen.get(target - nums[i]);\n    if (j !== undefined) return [j, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n',
  cpp: '#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < (int)nums.size(); i++) {\n        auto it = seen.find(target - nums[i]);\n        if (it != seen.end()) return {it->second, i};\n        seen[nums[i]] = i;\n    }\n    return {};\n}\n',
  java: 'import java.util.*;\n\nclass Solution {\n    public static int[] twoSum(int[] nums, int target) {\n        Map<Integer, Integer> seen = new HashMap<>();\n        for (int i = 0; i < nums.length; i++) {\n            Integer j = seen.get(target - nums[i]);\n            if (j != null) return new int[]{j, i};\n            seen.put(nums[i], i);\n        }\n        return new int[]{};\n    }\n}\n',
  go: 'func twoSum(nums []int, target int) []int {\n\tseen := map[int]int{}\n\tfor i, n := range nums {\n\t\tif j, ok := seen[target-n]; ok {\n\t\t\treturn []int{j, i}\n\t\t}\n\t\tseen[n] = i\n\t}\n\treturn nil\n}\n',
};

const SUM_STDIN = {
  python: 'a, b = map(int, input().split())\nprint(a + b)\n',
  javascript: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n",
  typescript: "const [a, b]: number[] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n",
  cpp: '#include <iostream>\n\nint main() {\n    long long a, b;\n    std::cin >> a >> b;\n    std::cout << a + b << std::endl;\n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        long a = in.nextLong(), b = in.nextLong();\n        System.out.println(a + b);\n    }\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int\n\tfmt.Scan(&a, &b)\n\tfmt.Println(a + b)\n}\n',
};

// Four threads spinning for 1.5 s of wall time each. On one CPU the process
// burns ~1.5 s of CPU; on four it would burn ~6 s.
const JAVA_SPIN =
  'public class Main {\n' +
  '    public static void main(String[] args) throws Exception {\n' +
  '        final long start = System.nanoTime();\n' +
  '        Thread[] ts = new Thread[4];\n' +
  '        for (int i = 0; i < 4; i++) {\n' +
  '            ts[i] = new Thread(() -> { while (System.nanoTime() - start < 1_500_000_000L) { } });\n' +
  '            ts[i].start();\n' +
  '        }\n' +
  '        for (Thread t : ts) t.join();\n' +
  '        System.out.println("availableProcessors " + Runtime.getRuntime().availableProcessors());\n' +
  '    }\n' +
  '}\n';

// The same in Go, after trying to widen its CPU mask to every CPU with a raw
// sched_setaffinity and raising GOMAXPROCS — what a learner would do to run
// goroutines in parallel.
const GO_SPIN_ESCAPE = `package main

import (
	"fmt"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

func cpus() int {
	var mask [16]uint64
	syscall.RawSyscall(syscall.SYS_SCHED_GETAFFINITY, 0, uintptr(len(mask)*8), uintptr(unsafe.Pointer(&mask[0])))
	n := 0
	for _, w := range mask {
		for ; w != 0; w &= w - 1 {
			n++
		}
	}
	return n
}

func main() {
	before := cpus()
	var all [16]uint64
	for i := range all {
		all[i] = ^uint64(0)
	}
	_, _, errno := syscall.RawSyscall(syscall.SYS_SCHED_SETAFFINITY, 0, uintptr(len(all)*8), uintptr(unsafe.Pointer(&all[0])))
	runtime.GOMAXPROCS(4)
	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Since(start) < 1500*time.Millisecond {
			}
		}()
	}
	wg.Wait()
	fmt.Printf("cpus before %d, setaffinity errno %d, cpus after %d\\n", before, int(errno), cpus())
}
`;

const GO_FLOCK = `package main

import (
	"fmt"
	"os"
	"syscall"
)

func main() {
	f, err := os.Create("lock.txt")
	if err != nil {
		panic(err)
	}
	fmt.Println("flock:", syscall.Flock(int(f.Fd()), syscall.LOCK_EX))
}
`;

const PY_NETWORK = `import socket
for target in [("1.1.1.1", 53), ("8.8.8.8", 443)]:
    try:
        socket.create_connection(target, timeout=2)
        print("CONNECTED", target)
    except OSError as e:
        print("blocked", target[0], e.strerror or e)
try:
    socket.getaddrinfo("example.com", 80)
    print("RESOLVED example.com")
except OSError as e:
    print("dns blocked", e.strerror or e)
`;

const PY_READ_HOST = `import os
print("root", sorted(os.listdir("/")))
for p in ["/etc/passwd", "/etc/hostname", "/proc/1/environ", "/proc/1/cmdline", "/app/backend/package.json",
          "/var/local/lib/isolate", "/tmp/codemare-gocache/trim.txt", "/sys/fs/cgroup/cgroup.procs",
          "/run/isolate/locks"]:
    try:
        with open(p, "rb") as f:
            print("READ", p, len(f.read(4096)))
    except OSError as e:
        print("denied", p, type(e).__name__)
print("pids", sorted(int(d) for d in os.listdir("/proc") if d.isdigit()))
print("env", sorted(os.environ))
`;

const PY_WRITE_OUTSIDE = `import os
for p in ["/pwned", "/usr/pwned", "/bin/pwned", "/lib/pwned", "/dev/pwned", "/proc/pwned", "/etc/pwned"]:
    try:
        with open(p, "w") as f:
            f.write("x")
        print("WROTE", p)
    except OSError as e:
        print("denied", p, type(e).__name__)
for p in ["/box/ok.txt", "/tmp/ok.txt"]:
    with open(p, "w") as f:
        f.write("ok")
print("box and tmp writable")
`;

const CPP_FORK_BOMB =
  '#include <cstdio>\n#include <unistd.h>\n\nint main() {\n    int forked = 0, refused = 0;\n' +
  '    for (int i = 0; i < 1000; i++) {\n        pid_t p = fork();\n        if (p == 0) { for (;;) pause(); }\n' +
  '        if (p > 0) forked++; else refused++;\n    }\n    std::printf("forked %d, refused %d\\n", forked, refused);\n    return 0;\n}\n';

const CPP_MEMORY_BOMB =
  '#include <cstdio>\n#include <cstdlib>\n#include <cstring>\n\nint main() {\n' +
  '    size_t total = 0;\n    for (;;) {\n        char* p = (char*)std::malloc(64 << 20);\n        if (!p) { std::printf("malloc failed at %zu MB\\n", total >> 20); return 1; }\n' +
  '        std::memset(p, 1, 64 << 20);\n        total += 64 << 20;\n    }\n}\n';

// ── checks ──────────────────────────────────────────────────────────────────

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

for (const language of Object.keys(TWO_SUM)) {
  check(`${language}: two-sum judged OK through /v1/run`, async () => {
    const r = await run(language, TWO_SUM[language]);
    expect(r.status === 'OK' && r.totalPassed === 3, `${r.status} ${r.totalPassed}/3 ${r.error ?? ''}`);
    return `OK 3/3, runUs=${r.runUs}${r.compileMs !== undefined ? `, compileMs=${r.compileMs}` : ''}`;
  });
}

for (const language of Object.keys(SUM_STDIN)) {
  check(`${language}: stdin/stdout program through /v1/ide/execute`, async () => {
    const t = await ide(language, SUM_STDIN[language], '2 3\n', '5');
    expect(t.status === 'OK' && t.passed, `${t.status} ${JSON.stringify(t.actualOutput)} ${t.error ?? ''}`);
    return `OK, output ${JSON.stringify(t.actualOutput)}, runMs=${t.runMs}`;
  });
}

check('WA: a wrong answer is judged WA', async () => {
  const r = await run('python', 'def twoSum(nums, target):\n    return [0, 0]\n');
  expect(r.status === 'WA', r.status);
  return `WA ${r.totalPassed}/${r.totalTests}`;
});

check('CE: compile errors point at the learner\'s own lines (C++, Java, Go)', async () => {
  const cpp = await run('cpp', '#include <vector>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    return undefinedThing;\n}\n');
  const java = await run('java', 'import java.util.*;\n\nclass Solution {\n    public static int[] twoSum(int[] nums, int target) {\n        return undefinedThing;\n    }\n}\n');
  const go = await run('go', 'func twoSum(nums []int, target int) []int {\n\treturn undefinedThing\n}\n');
  expect(cpp.status === 'CE' && /solution\.cpp:5:\d+: error/.test(cpp.error), `cpp: ${cpp.status} ${cpp.error}`);
  expect(java.status === 'CE' && /Main\.java:5: error/.test(java.error), `java: ${java.status} ${java.error}`);
  expect(go.status === 'CE' && /solution\.go:2:\d+: undefined/.test(go.error), `go: ${go.status} ${go.error}`);
  return [cpp, java, go].map((r) => r.error.split('\n').find((l) => /error|undefined/.test(l)).trim()).join(' | ');
});

check('TLE: an infinite loop stops at the time limit', async () => {
  const started = Date.now();
  const r = await run('python', 'def twoSum(nums, target):\n    while True:\n        pass\n', { timeMs: 1000 });
  expect(r.status === 'TLE', `${r.status} ${r.error}`);
  return `TLE after ${Date.now() - started} ms (limit 1000 ms CPU): ${r.tests[0].error}`;
});

check('cached recompile: unchanged C++ is not compiled again', async () => {
  const code = `// smoke ${Date.now()}\n${TWO_SUM.cpp}`;
  const first = await streamEvents('cpp', code);
  const second = await streamEvents('cpp', code);
  expect(first.includes('compiling'), `first run: ${first.join(',')}`);
  expect(!second.includes('compiling') && second.includes('verdict'), `second run: ${second.join(',')}`);
  return `first: ${first.filter((e) => e !== 'test').join(' → ')}; second: ${second.filter((e) => e !== 'test').join(' → ')}`;
});

check('Java prints UTF-8 (LANG=C.UTF-8 in the box)', async () => {
  const t = await ide('java', 'public class Main { public static void main(String[] a) { System.out.println("naïve ✓ 日本"); } }', '', 'naïve ✓ 日本');
  expect(t.passed, `${t.status} ${JSON.stringify(t.actualOutput)}`);
  return `output ${JSON.stringify(t.actualOutput.trim())}`;
});

check('containment: fork bomb stops at the PID cap', async () => {
  const t = await ide('cpp', CPP_FORK_BOMB);
  expect(exited(t) && /forked 0, refused 1000/.test(t.actualOutput), `${t.status} ${t.actualOutput} ${t.error ?? ''}`);
  return t.actualOutput.trim();
});

check('containment: memory bomb is MLE and the service stays up', async () => {
  const t = await ide('cpp', CPP_MEMORY_BOMB);
  expect(t.status === 'MLE', `${t.status} ${t.error ?? ''} ${t.actualOutput}`);
  const health = await fetch(`${BASE}/health`);
  const after = await ide('python', 'print(6 * 7)', '', '42');
  expect(health.ok && after.passed, 'service unhealthy after the memory bomb');
  return `${t.status} (${t.error}), peak ${t.memoryKb} KB; /health ${health.status}, next run OK`;
});

check('containment: output flood is capped with a clear error (Python, Java)', async () => {
  const py = await ide('python', 'import sys\nwhile True:\n    sys.stdout.write("x" * 65536)\n');
  expect(py.status === 'RE' && py.error === 'Output limit exceeded (16 MB)', `python: ${py.status} ${py.error}`);
  // Java's PrintStream swallows the write error and keeps looping: without
  // the size check this was a TLE.
  const java = await run('java', 'class Solution {\n    public static int[] twoSum(int[] nums, int target) {\n        String s = "x".repeat(65536);\n        while (true) System.out.print(s);\n    }\n}\n', { timeMs: 3000 });
  expect(java.status === 'RE' && /Output limit exceeded \(16 MB\)/.test(java.error), `java: ${java.status} ${java.error}`);
  return `python ${py.status} "${py.error}" (kept ${py.actualOutput.length} bytes); java ${java.status} "${java.error}"`;
});

check('containment: no network from a box', async () => {
  const t = await ide('python', PY_NETWORK);
  expect(exited(t) && !/CONNECTED|RESOLVED/.test(t.actualOutput), t.actualOutput);
  return t.actualOutput.trim().replace(/\n/g, ' | ');
});

check('containment: host files are out of reach', async () => {
  const t = await ide('python', PY_READ_HOST);
  const out = t.actualOutput;
  expect(exited(t), `${t.status} ${t.error}`);
  expect(!/^READ /m.test(out), `a host file was readable:\n${out}`);
  expect(/^env \['HOME', 'LANG', 'LIBC_FATAL_STDERR_', 'PATH'\]$/m.test(out), `unexpected environment:\n${out}`);
  return out.trim().replace(/\n/g, ' | ');
});

check('containment: nothing outside /box and /tmp is writable', async () => {
  const t = await ide('python', PY_WRITE_OUTSIDE);
  expect(exited(t) && !/WROTE/.test(t.actualOutput) && /box and tmp writable/.test(t.actualOutput), `${t.status} ${t.actualOutput} ${t.error ?? ''}`);
  return t.actualOutput.trim().replace(/\n/g, ' | ');
});

check('containment: 4 Java threads share one CPU (CPU time ≈ wall time)', async () => {
  const t = await ide('java', JAVA_SPIN);
  const ratio = t.runMs / t.wallMs;
  expect(exited(t), `${t.status} ${t.error}`);
  expect(/availableProcessors 1\b/.test(t.actualOutput), t.actualOutput);
  expect(ratio < 1.3, `CPU/wall ${ratio.toFixed(2)}: threads ran in parallel`);
  return `cpu ${Math.round(t.runMs)} ms / wall ${Math.round(t.wallMs)} ms = ${ratio.toFixed(2)}; ${t.actualOutput.trim()}`;
});

check('containment: Go cannot widen its CPU mask (cpuset), 4 goroutines share one CPU', async () => {
  const t = await ide('go', GO_SPIN_ESCAPE);
  const ratio = t.runMs / t.wallMs;
  expect(exited(t), `${t.status} ${t.error}`);
  expect(/cpus before 1, setaffinity errno 0, cpus after 1$/m.test(t.actualOutput), t.actualOutput);
  expect(ratio < 1.3, `CPU/wall ${ratio.toFixed(2)}: goroutines ran in parallel`);
  return `cpu ${Math.round(t.runMs)} ms / wall ${Math.round(t.wallMs)} ms = ${ratio.toFixed(2)}; ${t.actualOutput.trim()}`;
});

check('syscalls: a Go run box cannot lock files (only go build\'s compile box may)', async () => {
  const t = await ide('go', GO_FLOCK);
  expect(exited(t) && /flock: function not implemented/.test(t.actualOutput), `${t.status} ${t.actualOutput} ${t.error ?? ''}`);
  return `compiled by go build (file locks allowed there); in the run box: ${t.actualOutput.trim()}`;
});

// ── run ─────────────────────────────────────────────────────────────────────

let failed = 0;
const started = Date.now();
for (const { name, fn } of checks) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name} (${Date.now() - t0} ms)\n      ${detail}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name} (${Date.now() - t0} ms)\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s against ${BASE}`);
process.exitCode = failed === 0 ? 0 : 1;
