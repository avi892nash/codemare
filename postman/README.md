# Codemare API Postman Collection

Complete Postman collection for testing the Codemare Backend API with working code examples for Python, JavaScript, C++, and Java.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Collection Structure](#collection-structure)
- [Usage](#usage)
- [Code Examples](#code-examples)
- [Expected Results](#expected-results)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)

## Overview

This Postman collection provides:
- **24 comprehensive requests** covering all API endpoints
- **8 working solutions** (4 languages × 2 problems)
- **8 error cases** for testing validation
- **100+ automated test scripts** for validation
- **Environment variables** for easy configuration

## Prerequisites

1. **Postman** - Desktop app or web version ([Download](https://www.postman.com/downloads/))
2. **Codemare backend** - Running on port 3000
3. **Docker** - Required for code execution
4. **Docker containers** - All executor images built (python, javascript, cpp, java)

### Starting the Backend

```bash
# Navigate to backend directory
cd /Users/avinashverma/Github/codemare/backend

# Build Docker executor images
docker-compose build

# Start the backend server
npm run dev
# OR
npm start
```

Verify the backend is running:
```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}
```

## Installation

### 1. Import Collection

1. Open Postman
2. Click **"Import"** button (top-left)
3. Select `Codemare_API.postman_collection.json`
4. Collection appears in your workspace

### 2. Import Environment

1. Click the gear icon (⚙️) **"Manage Environments"** (top-right)
2. Click **"Import"**
3. Select `Codemare_Environment.postman_environment.json`
4. Close the environment manager

### 3. Select Environment

1. Click the environment dropdown (top-right)
2. Select **"Codemare Environment"**
3. Verify variables are loaded:
   - `baseUrl`: http://localhost:3000
   - `problemId_twoSum`: two-sum
   - `problemId_reverseString`: reverse-string

## Collection Structure

```
Codemare Backend API (24 requests)
├── 01 - Health Check (1 request)
│   └── GET Health Status
├── 02 - Problems (3 requests)
│   ├── GET All Problems
│   ├── GET Two Sum Problem
│   └── GET Reverse String Problem
├── 03 - Execute Python (4 requests)
│   ├── Two Sum - Valid Solution
│   ├── Two Sum - Invalid Solution
│   ├── Reverse String - Valid Solution
│   └── Reverse String - Syntax Error
├── 04 - Execute JavaScript (4 requests)
│   ├── Two Sum - Valid Solution
│   ├── Two Sum - Runtime Error
│   ├── Reverse String - Valid Solution
│   └── Reverse String - Wrong Answer
├── 05 - Execute C++ (4 requests)
│   ├── Two Sum - Valid Solution
│   ├── Two Sum - Compilation Error
│   ├── Reverse String - Valid Solution
│   └── Reverse String - Invalid Solution
├── 06 - Execute Java (4 requests)
│   ├── Two Sum - Valid Solution
│   ├── Two Sum - Compilation Error
│   ├── Reverse String - Valid Solution
│   └── Reverse String - Runtime Error
└── 07 - Error Cases (4 requests)
    ├── Execute - Invalid Language
    ├── Execute - Code Too Large
    ├── Execute - Problem Not Found
    └── Execute - Missing Fields
```

## Usage

### Running Individual Requests

1. Expand collection folders in left sidebar
2. Select any request
3. Click **"Send"** button
4. View response in bottom panel
5. Check **"Test Results"** tab for automated validation

### Running Full Test Suite

1. Click three dots (⋯) next to collection name
2. Select **"Run collection"**
3. Configure Collection Runner:
   - **Environment**: Codemare Environment
   - **Delay**: 500ms (recommended)
   - **Iterations**: 1
4. Click **"Run Codemare Backend API"**
5. View results summary

**Expected Results**:
- 24 requests executed
- 100+ tests passed
- 0 failures for valid solutions
- Expected failures for error cases

## Code Examples

### Two Sum Problem

#### Python
```python
def twoSum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
    return []
```

#### JavaScript
```javascript
function twoSum(nums, target) {
    const seen = {};
    for (let i = 0; i < nums.length; i++) {
        const complement = target - nums[i];
        if (complement in seen) {
            return [seen[complement], i];
        }
        seen[nums[i]] = i;
    }
    return [];
}
```

#### C++
```cpp
#include <vector>
#include <unordered_map>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < nums.size(); i++) {
        int complement = target - nums[i];
        if (seen.find(complement) != seen.end()) {
            return {seen[complement], i};
        }
        seen[nums[i]] = i;
    }
    return {};
}
```

#### Java
```java
class Solution {
    public int[] twoSum(int[] nums, int target) {
        java.util.HashMap<Integer, Integer> seen = new java.util.HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (seen.containsKey(complement)) {
                return new int[]{seen.get(complement), i};
            }
            seen.put(nums[i], i);
        }
        return new int[]{};
    }
}
```

### Reverse String Problem

#### Python
```python
def reverseString(s):
    left, right = 0, len(s) - 1
    while left < right:
        s[left], s[right] = s[right], s[left]
        left += 1
        right -= 1
    return s
```

#### JavaScript
```javascript
function reverseString(s) {
    let left = 0;
    let right = s.length - 1;
    while (left < right) {
        const temp = s[left];
        s[left] = s[right];
        s[right] = temp;
        left++;
        right--;
    }
    return s;
}
```

#### C++
```cpp
#include <vector>
using namespace std;

vector<char> reverseString(vector<char>& s) {
    int left = 0;
    int right = s.size() - 1;
    while (left < right) {
        char temp = s[left];
        s[left] = s[right];
        s[right] = temp;
        left++;
        right--;
    }
    return s;
}
```

#### Java
```java
class Solution {
    public char[] reverseString(char[] s) {
        int left = 0;
        int right = s.length - 1;
        while (left < right) {
            char temp = s[left];
            s[left] = s[right];
            s[right] = temp;
            left++;
            right--;
        }
        return s;
    }
}
```

## Expected Results

### Valid Solutions

All valid solution requests should return:

```json
{
  "success": true,
  "testResults": [
    {
      "input": [[2, 7, 11, 15], 9],
      "expectedOutput": [0, 1],
      "actualOutput": [0, 1],
      "passed": true,
      "executionTime": 2.5
    }
  ],
  "totalPassed": 5,
  "totalTests": 5,
  "executionTime": 156,
  "memoryUsed": 0
}
```

**Key Fields**:
- `success`: true when all tests pass
- `totalPassed`: Number of passing tests
- `totalTests`: Total number of tests (visible + hidden)
- `testResults`: Array of individual test results
- `executionTime`: Total execution time in milliseconds

### Invalid Solutions

Invalid solutions should return:

```json
{
  "success": false,
  "totalPassed": 0,
  "totalTests": 5,
  "testResults": [...],
  "error": "error message"
}
```

### Compilation/Syntax Errors

```json
{
  "error": "Compilation Error: main.cpp:5:1: error: expected ';' after return statement"
}
```

## Troubleshooting

### Issue: "Could not get response"

**Symptom**: Requests fail with connection error

**Solutions**:
1. Verify backend is running:
   ```bash
   curl http://localhost:3000/health
   ```
2. Check environment variable `baseUrl` is set correctly
3. Ensure no firewall blocking localhost:3000
4. Verify backend logs for errors:
   ```bash
   npm run dev
   # Check console output
   ```

### Issue: "Docker containers not running"

**Symptom**: Code execution requests timeout or fail

**Solutions**:
1. Build Docker images:
   ```bash
   cd backend
   docker-compose build
   ```
2. Verify Docker is running:
   ```bash
   docker ps
   ```
3. Check Docker service status:
   ```bash
   docker info
   ```

### Issue: "All tests failing"

**Symptom**: Test scripts fail validation

**Solutions**:
1. Verify environment is selected (top-right dropdown)
2. Check `baseUrl` in environment matches your server
3. Update environment if using different port:
   - Click gear icon
   - Select "Codemare Environment"
   - Edit `baseUrl` value
   - Save

### Issue: "Execution timeout"

**Symptom**: Requests take too long or timeout

**Solutions**:
1. Increase Postman timeout:
   - File > Settings > General
   - Request timeout: 30000 (30 seconds)
2. Check Docker container performance:
   ```bash
   docker stats
   ```
3. Restart Docker containers:
   ```bash
   docker-compose restart
   ```

### Issue: "Wrong test results"

**Symptom**: Valid code returns failures

**Solutions**:
1. Review exact function signature in problem definition
2. Check return type matches expected output
3. Verify test case inputs in GET problem endpoint
4. Ensure code handles all edge cases

### Issue: "Environment variables not working"

**Symptom**: URLs show {{baseUrl}} instead of actual value

**Solutions**:
1. Select environment from dropdown (top-right)
2. Verify environment is active (green checkmark)
3. Re-import environment file if needed
4. Restart Postman

## API Reference

### Base URL
```
http://localhost:3000
```

### Endpoints

#### 1. GET /health

Health check endpoint.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2025-11-27T00:00:00.000Z"
}
```

---

#### 2. GET /api/problems

Get all available problems.

**Response**:
```json
[
  {
    "id": "two-sum",
    "title": "Two Sum",
    "difficulty": "Easy"
  },
  {
    "id": "reverse-string",
    "title": "Reverse String",
    "difficulty": "Easy"
  }
]
```

---

#### 3. GET /api/problems/:id

Get specific problem details.

**Parameters**:
- `id` (path): Problem identifier (e.g., "two-sum")

**Response**:
```json
{
  "id": "two-sum",
  "title": "Two Sum",
  "difficulty": "Easy",
  "description": "Given an array of integers...",
  "examples": [...],
  "constraints": [...],
  "starterCode": {
    "python": "def twoSum(nums, target):\n    pass",
    "javascript": "function twoSum(nums, target) {}",
    "cpp": "vector<int> twoSum(vector<int>& nums, int target) {}",
    "java": "public int[] twoSum(int[] nums, int target) {}"
  },
  "functionName": "twoSum",
  "testCases": [...]
}
```

**Note**: Hidden test cases have input/output fields set to null for security.

---

#### 4. POST /api/execute

Execute user code against test cases.

**Request Body**:
```json
{
  "problemId": "two-sum",
  "language": "python|javascript|cpp|java",
  "code": "def twoSum(nums, target):\n    ..."
}
```

**Validations**:
- `problemId`: Required, must exist in system
- `language`: Required, must be python|javascript|cpp|java
- `code`: Required, non-empty, max 10KB (10,000 characters)

**Response** (Success):
```json
{
  "success": true,
  "testResults": [
    {
      "input": [[2, 7, 11, 15], 9],
      "expectedOutput": [0, 1],
      "actualOutput": [0, 1],
      "passed": true,
      "executionTime": 2.5,
      "hidden": false
    }
  ],
  "totalPassed": 5,
  "totalTests": 5,
  "executionTime": 156,
  "memoryUsed": 0
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "Compilation Error: ...",
  "totalPassed": 0,
  "totalTests": 5,
  "testResults": [...]
}
```

**Error Types**:
- `Compilation Error`: C++/Java compilation failed
- `Syntax Error`: Python/JavaScript syntax error
- `Runtime Error`: Code crashed during execution
- `Time Limit Exceeded`: Execution timeout (10 seconds)
- `Invalid language`: Unsupported language specified
- `Problem not found`: Invalid problem ID
- `Code too large`: Code exceeds 10KB limit

---

## Testing Strategy

### Manual Testing
1. Import collection and environment
2. Select environment
3. Run health check first
4. Run problem endpoints
5. Test valid solutions (should all pass)
6. Test error cases (should fail appropriately)

### Automated Testing
Use Collection Runner for full test suite:
1. 24 requests executed sequentially
2. 100+ tests validated
3. Average 2-3 seconds per execution
4. Total runtime: ~60 seconds

### Continuous Integration
For CI/CD pipelines, use Newman (Postman CLI):

```bash
# Install Newman
npm install -g newman

# Run collection
newman run Codemare_API.postman_collection.json \
  -e Codemare_Environment.postman_environment.json \
  --reporters cli,json

# With timeout and delay
newman run Codemare_API.postman_collection.json \
  -e Codemare_Environment.postman_environment.json \
  --timeout-request 30000 \
  --delay-request 500
```

## Adding New Tests

To extend the collection:

1. **Add New Problem**:
   - Create request in "02 - Problems" folder
   - Add GET endpoint for new problem
   - Include test scripts

2. **Add Language Support**:
   - Create folder "0X - Execute [Language]"
   - Add valid/invalid solution requests
   - Include compilation/runtime error examples
   - Update test scripts

3. **Add Error Cases**:
   - Add request to "07 - Error Cases" folder
   - Include appropriate test scripts
   - Document expected behavior

## Support

For issues or questions:
- Check [Troubleshooting](#troubleshooting) section
- Review API documentation above
- Check backend server logs
- Verify Docker containers are running
- Ensure all prerequisites are met

## Version History

- **v1.0.0** (2025-11-27): Initial release
  - 24 requests covering all endpoints
  - 4 languages supported (Python, JS, C++, Java)
  - 2 problems included (Two Sum, Reverse String)
  - Comprehensive test coverage with 100+ automated tests
  - Complete documentation and examples

## License

This Postman collection is part of the Codemare project.
