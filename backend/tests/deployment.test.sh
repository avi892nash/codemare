#!/bin/bash
# Deployment smoke for a running compile service: health, the pure executor
# (POST /v1/run, POST /v1/run/stream) and IDE mode (POST /v1/ide/execute).
#
#   npm run test:deployment -w backend        # service on http://localhost:4000
#   BASE_URL=http://localhost:3000 INTERNAL_TOKEN=<token> ./tests/deployment.test.sh
#
# BASE_URL defaults to the service's default port, 4000 (`npm run dev`, the
# Docker image); the systemd unit (deploy/codemare-backend.service) sets
# PORT=3000. INTERNAL_TOKEN is sent as X-Codemare-Token when set — needed
# whenever the service has one configured (always in production). Needs curl.
set -e

BASE_URL="${BASE_URL:-http://localhost:4000}"
AUTH=()
if [ -n "${INTERNAL_TOKEN:-}" ]; then
    AUTH=(-H "X-Codemare-Token: ${INTERNAL_TOKEN}")
fi

# POST a JSON body: $1 = path, $2 = body. A transport failure yields an empty
# response (reported by the test) instead of a silent exit under set -e.
post() {
    curl -s -X POST "${BASE_URL}$1" -H "Content-Type: application/json" "${AUTH[@]}" -d "$2" || true
}

# Two Sum, judged by the service against tests the caller sends.
TWO_SUM_SIGNATURE='{"params":[{"name":"nums","type":"int[]"},{"name":"target","type":"int"}],"returns":"int[]"}'
TWO_SUM_TESTS='[{"input":[[2,7,11,15],9],"expected":[0,1]},{"input":[[3,2,4],6],"expected":[1,2]},{"input":[[3,3],6],"expected":[0,1],"hidden":true}]'

echo "🧪 Running Codemare Backend Deployment Tests against ${BASE_URL}..."
echo ""

# Test 1: Health check
echo "Test 1: Health check..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" || true)
if [ "$HEALTH_RESPONSE" = "200" ]; then
    echo "✅ Health check passed (HTTP 200)"
else
    echo "❌ Health check failed (HTTP $HEALTH_RESPONSE)"
    exit 1
fi
echo ""

# Test 2: Python through POST /v1/run
echo "Test 2: Testing Python code execution (POST /v1/run)..."
PYTHON_RESULT=$(post /v1/run '{
    "language": "python",
    "code": "def twoSum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        complement = target - num\n        if complement in seen:\n            return [seen[complement], i]\n        seen[num] = i\n    return []",
    "functionName": "twoSum",
    "compareMode": "unordered",
    "tests": '"$TWO_SUM_TESTS"'
  }')

if echo "$PYTHON_RESULT" | grep -q '"status":"OK"'; then
    echo "✅ Python execution working"
else
    echo "❌ Python execution failed"
    echo "Response: $PYTHON_RESULT"
    exit 1
fi
echo ""

# Test 3: JavaScript through POST /v1/run
echo "Test 3: Testing JavaScript code execution (POST /v1/run)..."
JS_RESULT=$(post /v1/run '{
    "language": "javascript",
    "code": "function twoSum(nums, target) {\n  const seen = {};\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (complement in seen) {\n      return [seen[complement], i];\n    }\n    seen[nums[i]] = i;\n  }\n  return [];\n}",
    "functionName": "twoSum",
    "compareMode": "unordered",
    "tests": '"$TWO_SUM_TESTS"'
  }')

if echo "$JS_RESULT" | grep -q '"status":"OK"'; then
    echo "✅ JavaScript execution working"
else
    echo "❌ JavaScript execution failed"
    echo "Response: $JS_RESULT"
    exit 1
fi
echo ""

# Test 4: C++ through POST /v1/run (typed languages need the signature)
echo "Test 4: Testing C++ code execution (POST /v1/run)..."
CPP_RESULT=$(post /v1/run '{
    "language": "cpp",
    "code": "#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < (int)nums.size(); i++) {\n        int complement = target - nums[i];\n        if (seen.find(complement) != seen.end()) {\n            return {seen[complement], i};\n        }\n        seen[nums[i]] = i;\n    }\n    return {};\n}",
    "functionName": "twoSum",
    "signature": '"$TWO_SUM_SIGNATURE"',
    "compareMode": "unordered",
    "tests": '"$TWO_SUM_TESTS"'
  }')

if echo "$CPP_RESULT" | grep -q '"status":"OK"'; then
    echo "✅ C++ execution working"
else
    echo "❌ C++ execution failed"
    echo "Response: $CPP_RESULT"
    exit 1
fi
echo ""

# Test 5: Error handling (a syntax error is a CE verdict, not an HTTP error)
echo "Test 5: Testing error handling..."
ERROR_RESULT=$(post /v1/run '{
    "language": "python",
    "code": "def twoSum(nums, target):\n    this is invalid syntax",
    "functionName": "twoSum",
    "tests": '"$TWO_SUM_TESTS"'
  }')

if echo "$ERROR_RESULT" | grep -q '"status":"CE"'; then
    echo "✅ Error handling working"
else
    echo "❌ Error handling failed"
    echo "Response: $ERROR_RESULT"
    exit 1
fi
echo ""

# Test 6: The same run as Server-Sent Events
echo "Test 6: Testing the SSE stream (POST /v1/run/stream)..."
STREAM_RESULT=$(curl -s -N -X POST "${BASE_URL}/v1/run/stream" \
  -H "Content-Type: application/json" -H "Accept: text/event-stream" "${AUTH[@]}" \
  -d '{
    "language": "python",
    "code": "def twoSum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        if target - num in seen:\n            return [seen[target - num], i]\n        seen[num] = i\n    return []",
    "functionName": "twoSum",
    "compareMode": "unordered",
    "tests": '"$TWO_SUM_TESTS"'
  }' || true)

if [ "$(echo "$STREAM_RESULT" | grep -c '^event: test$')" -eq 3 ] &&
   echo "$STREAM_RESULT" | grep -A1 '^event: verdict$' | grep -q '"status":"OK"'; then
    echo "✅ SSE stream working"
else
    echo "❌ SSE stream failed"
    echo "Response: $STREAM_RESULT"
    exit 1
fi
echo ""

# Test 7: IDE mode (stdin/stdout programs; ?wait=true answers inline even
# when the Redis queue is on)
echo "Test 7: Testing IDE execution (POST /v1/ide/execute)..."
IDE_RESULT=$(post '/v1/ide/execute?wait=true' '{
    "language": "python",
    "code": "a, b = map(int, input().split())\nprint(a + b)",
    "testCases": [
      {"input": "2 3", "expectedOutput": "5"},
      {"input": "10 20", "expectedOutput": "30"}
    ]
  }')

if echo "$IDE_RESULT" | grep -q '"success":true'; then
    echo "✅ IDE execution working"
else
    echo "❌ IDE execution failed"
    echo "Response: $IDE_RESULT"
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════"
echo "✅ ALL TESTS PASSED!"
echo "═══════════════════════════════════════════"
echo ""
echo "Deployment runbooks: deploy/README.md (Docker Compose) and"
echo "backend/DEPLOYMENT.md (systemd VM)."
echo ""
