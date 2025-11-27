#!/bin/bash
set -e

echo "🧪 Running Codemare Backend Deployment Tests..."
echo ""

# Test 1: Build production Docker image
echo "Test 1: Building production image..."
docker build -f Dockerfile.production -t codemare-backend:test . || {
    echo "❌ Failed to build production image"
    exit 1
}
echo "✅ Production image built successfully"
echo ""

# Test 2: Build executor images
echo "Test 2: Building executor images..."
docker-compose -f docker-compose.production.yml build || {
    echo "❌ Failed to build executor images"
    exit 1
}
echo "✅ Executor images built successfully"
echo ""

# Test 3: Start containers
echo "Test 3: Starting containers..."
docker-compose -f docker-compose.production.yml up -d || {
    echo "❌ Failed to start containers"
    exit 1
}
echo "✅ Containers started successfully"
echo ""

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 15

# Test 4: Health check
echo "Test 4: Health check..."
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$HEALTH_RESPONSE" = "200" ]; then
    echo "✅ Health check passed (HTTP 200)"
else
    echo "❌ Health check failed (HTTP $HEALTH_RESPONSE)"
    docker-compose -f docker-compose.production.yml logs backend
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Test 5: Get problems list
echo "Test 5: Fetching problems list..."
PROBLEMS_RESPONSE=$(curl -s http://localhost:3000/api/problems)
if echo "$PROBLEMS_RESPONSE" | grep -q "two-sum"; then
    echo "✅ Problems endpoint working"
else
    echo "❌ Problems endpoint failed"
    echo "Response: $PROBLEMS_RESPONSE"
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Test 6: Execute Python code
echo "Test 6: Testing Python code execution..."
PYTHON_RESULT=$(curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "python",
    "code": "def twoSum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        complement = target - num\n        if complement in seen:\n            return [seen[complement], i]\n        seen[num] = i\n    return []"
  }')

if echo "$PYTHON_RESULT" | grep -q '"success":true'; then
    echo "✅ Python execution working"
else
    echo "❌ Python execution failed"
    echo "Response: $PYTHON_RESULT"
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Test 7: Execute JavaScript code
echo "Test 7: Testing JavaScript code execution..."
JS_RESULT=$(curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "javascript",
    "code": "function twoSum(nums, target) {\n  const seen = {};\n  for (let i = 0; i < nums.length; i++) {\n    const complement = target - nums[i];\n    if (complement in seen) {\n      return [seen[complement], i];\n    }\n    seen[nums[i]] = i;\n  }\n  return [];\n}"
  }')

if echo "$JS_RESULT" | grep -q '"success":true'; then
    echo "✅ JavaScript execution working"
else
    echo "❌ JavaScript execution failed"
    echo "Response: $JS_RESULT"
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Test 8: Execute C++ code
echo "Test 8: Testing C++ code execution..."
CPP_RESULT=$(curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "cpp",
    "code": "#include <vector>\n#include <unordered_map>\nusing namespace std;\n\nvector<int> twoSum(vector<int>& nums, int target) {\n    unordered_map<int, int> seen;\n    for (int i = 0; i < nums.size(); i++) {\n        int complement = target - nums[i];\n        if (seen.find(complement) != seen.end()) {\n            return {seen[complement], i};\n        }\n        seen[nums[i]] = i;\n    }\n    return {};\n}"
  }')

if echo "$CPP_RESULT" | grep -q '"success":true'; then
    echo "✅ C++ execution working"
else
    echo "❌ C++ execution failed"
    echo "Response: $CPP_RESULT"
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Test 9: Test error handling (invalid code)
echo "Test 9: Testing error handling..."
ERROR_RESULT=$(curl -s -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "python",
    "code": "def twoSum(nums, target):\n    this is invalid syntax"
  }')

if echo "$ERROR_RESULT" | grep -q '"success":false'; then
    echo "✅ Error handling working"
else
    echo "❌ Error handling failed"
    echo "Response: $ERROR_RESULT"
    docker-compose -f docker-compose.production.yml down
    exit 1
fi
echo ""

# Cleanup
echo "🧹 Cleaning up..."
docker-compose -f docker-compose.production.yml down
docker system prune -f

echo ""
echo "═══════════════════════════════════════════"
echo "✅ ALL TESTS PASSED!"
echo "═══════════════════════════════════════════"
echo ""
echo "Your Codemare backend is ready for deployment!"
echo ""
echo "Next steps:"
echo "1. Push your code to GitHub"
echo "2. Provision a VPS (Hetzner CX21 recommended - €4.51/month)"
echo "3. Run ./deploy.sh on your VPS"
echo "4. Setup Nginx reverse proxy and SSL"
echo ""
echo "Or deploy to Kubernetes:"
echo "1. Build and push Docker image to registry"
echo "2. Update k8s/deployment.yaml with your image"
echo "3. Run cd k8s && ./deploy.sh"
echo ""
