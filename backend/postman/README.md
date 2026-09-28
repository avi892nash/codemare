# Codemare compile service: Postman collection

Requests for the compile service in `backend/`, the stateless executor the web
app calls to judge code. Every request has a test script, so running the whole
collection doubles as a smoke test of a running service.

| File | What |
|---|---|
| `Codemare_API.postman_collection.json` | 24 requests in five folders |
| `Codemare_Environment.postman_environment.json` | `baseUrl` and `internalToken` |

## Setup

1. **Start the service.** From the repo root, `npm run dev:backend` (or
   `npm run dev`, which starts the web app too) serves it on
   http://localhost:4000. Without isolate (e.g. on macOS) it runs code with
   the unsandboxed local adapter; to judge every language the host needs
   Python 3, Node, g++, a JDK and Go 1.22+. The startup log lists which
   languages passed its probe (`Available:` / `Unavailable:`).
2. **Import** both files into Postman and select the **Codemare Environment**.
3. **Variables:**

   | Variable | Default | Meaning |
   |---|---|---|
   | `baseUrl` | `http://localhost:4000` | Where the service listens. 4000 is its default port (also in the Docker image); the systemd unit in `deploy/` sets 3000. |
   | `internalToken` | empty | Sent as `X-Codemare-Token` on every `/v1` request. Leave it empty for a local service started without `INTERNAL_TOKEN`; otherwise paste that value (the service requires it in production). Keep it in the environment, never in the collection. |

   The collection keeps one variable of its own, `ideToken`: "Submit without
   wait" sets it and "Poll a queued run" reads it.

## What's in it

```
01 - Health
    GET /health                                   open; {status: "ok", timestamp}
02 - Run (POST /v1/run)
    Two Sum - Python / JavaScript / TypeScript / C++ / Java / Go (OK)
    Wrong answer - Python (WA)
    Syntax error - Python (CE)
    Compile error - C++ (CE)
    Runtime error - Python (RE)
    Time limit - Python (TLE)                     limits.timeMs = 1000
    Prelude - Python helper (OK)
    Validation - C++ without a signature (400)
03 - Run stream (POST /v1/run/stream)
    Two Sum - C++ (SSE)
04 - IDE (POST /v1/ide/execute)
    Python - sum of two numbers (wait)
    Java - Scanner input (wait)
    Go - word count (wait)
    Wrong output - Python (WA case)
    Submit without wait (202 token when queued)
    Poll a queued run                             GET /v1/ide/execute/{{ideToken}}
    Validation - too many test cases (400)
    Validation - unknown language (400)
05 - Queue
    GET /v1/queue/stats
```

Run the folders in order: the poll request uses the token from the submit
before it.

## The API in brief

The full contract is `docs/spec/architecture.md` §5; request validation lives
in `backend/src/services/runValidation.ts`.

### `POST /v1/run` and `POST /v1/run/stream`

The caller sends the code and the tests; the service keeps no state about
questions.

```jsonc
{
  "language": "cpp",                  // python | javascript | typescript | cpp | java | go
  "code": "std::vector<int> twoSum(std::vector<int>& nums, int target) { ... }",
  "functionName": "twoSum",
  "signature": {                      // required for cpp, java and go
    "params": [{ "name": "nums", "type": "int[]" }, { "name": "target", "type": "int" }],
    "returns": "int[]"                // int | long | double | bool | string | char, plus [] or [][]
  },
  "compareMode": "unordered",         // optional; "ordered" (default) or "unordered"
  "tests": [                          // 1-200; input is the argument list
    { "input": [[2, 7, 11, 15], 9], "expected": [0, 1] },
    { "input": [[3, 3], 6], "expected": [0, 1], "hidden": true }
  ],
  "prelude": [],                      // optional sources placed before code (not Java)
  "limits": { "timeMs": 5000, "memoryMb": 256 }   // optional; 100-10000 ms, 32-512 MB
}
```

Java code is a `class Solution` with a `public static` method; C++ and Go code
is the function itself (the harness supplies `main`).

`/v1/run` answers with the verdict and one result per test:

```jsonc
{
  "status": "OK",                     // OK | WA | TLE | MLE | RE | CE | XX
  "totalPassed": 2, "totalTests": 2,
  "runUs": 7, "memoryKb": 1,          // CPU µs summed over tests; peak memory
  "compileMs": 812,                   // compiled languages and TypeScript
  "tests": [
    { "idx": 0, "hidden": false, "passed": true, "runUs": 4, "wallUs": 5, "memoryKb": 1, "actual": [0, 1] }
  ]
}
```

A syntax or compile error is a `CE` verdict with `error` and no tests, not an
HTTP error; a malformed request is a 400 `{error, details}`.

`/v1/run/stream` (send `Accept: text/event-stream`) is the same run as
Server-Sent Events: `queued` (only while waiting for a sandbox box),
`compiling` (TypeScript, and compiled languages on a compile-cache miss),
`running`, one `test` per test in order, then `verdict` (the JSON result
without `tests`), or `error` if the run itself failed. Comment lines
(`: keep-alive`) arrive every 15 s.

Both always run inline in the API process, never through the queue.

### `POST /v1/ide/execute` and `GET /v1/ide/execute/:token`

Whole programs reading stdin and writing stdout:

```json
{
  "language": "python",
  "code": "a, b = map(int, input().split())\nprint(a + b)\n",
  "testCases": [{ "input": "2 3", "expectedOutput": "5" }]
}
```

1-10 cases, compared on stdout with trailing whitespace ignored. The answer
is `{success, testResults: [{input, expectedOutput, actualOutput, passed,
status, runMs, memoryKb, error?, ...}], totalPassed, totalTests,
totalExecutionTime}`.

With `?wait=true`, or when the service has no `REDIS_URL`, the result comes
back directly. Otherwise the run is queued: 202 `{token, status: "PND"}`, and
`GET /v1/ide/execute/:token` answers `{status: "PND"}` until the result is
ready (kept for `QUEUE_RESULT_TTL_SEC`, default 3600 s). An unknown or expired
token is a 404.

### `GET /v1/queue/stats`

`{enabled: false}` without `REDIS_URL`; otherwise the queue's name, worker
concurrency, result TTL and job counts.

## Troubleshooting

- **401 `Missing X-Codemare-Token header` / 403 `Invalid X-Codemare-Token`:**
  the service has `INTERNAL_TOKEN` set; put the same value in `internalToken`.
- **404 `{"error":"Not found"}`:** a path the service doesn't have. The
  pre-`/v1/run` endpoints (`/v1/problems`, `/v1/execute`) and the `/api/*`
  aliases were removed.
- **"Poll a queued run" answers 404:** expected when the service runs without
  `REDIS_URL`; nothing was queued.
- **One language fails every run:** check the service's startup log; a
  language listed under `Unavailable:` has no working toolchain on that host.
- **429 `Too many code execution requests`:** the circuit breaker shared by
  the execution routes (`EXECUTION_RATE_LIMIT_MAX`, default 6000 requests per
  minute per process).
