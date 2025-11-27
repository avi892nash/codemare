# Backend Tasks Breakdown

## Current Status: ✅ Core Complete (Production Ready)

The backend is fully functional with all essential features implemented. The tasks below are optional enhancements and additional problems.

---

## Optional Enhancement Tasks

### Task B1: Add More Sample Problems (Priority: Low)

**Estimated Time:** 30 minutes per problem

Create 3-5 additional problems to expand the problem library.

#### Subtasks:

**B1.1: FizzBuzz Problem**
- File: `backend/src/data/problems/fizzbuzz.json`
- Difficulty: Easy
- Type: Control flow, conditionals
- Description: Print "Fizz" for multiples of 3, "Buzz" for 5, "FizzBuzz" for both
- Test cases: 5 total (3 visible, 2 hidden)
- Starter code for all 4 languages

**B1.2: Valid Parentheses Problem**
- File: `backend/src/data/problems/valid-parentheses.json`
- Difficulty: Easy
- Type: Stack data structure
- Description: Check if string of brackets is valid
- Test cases: 6 total (4 visible, 2 hidden)
- Starter code for all 4 languages

**B1.3: Palindrome Number**
- File: `backend/src/data/problems/palindrome-number.json`
- Difficulty: Easy
- Type: Math, number manipulation
- Description: Check if integer is palindrome
- Test cases: 5 total (3 visible, 2 hidden)
- Starter code for all 4 languages

**B1.4: Binary Search**
- File: `backend/src/data/problems/binary-search.json`
- Difficulty: Easy
- Type: Searching algorithm
- Description: Search for target in sorted array
- Test cases: 6 total (4 visible, 2 hidden)
- Starter code for all 4 languages

**B1.5: Update index.json**
- Add all new problems to the index
- Maintain alphabetical or difficulty order

---

### Task B2: Rate Limiting (Priority: Medium)

**Estimated Time:** 2 hours

Prevent abuse by limiting execution requests per IP address.

#### Implementation Plan:

**B2.1: Install Dependencies**
```bash
cd backend
npm install express-rate-limit
npm install --save-dev @types/express-rate-limit
```

**B2.2: Create Rate Limiter Middleware**
- File: `backend/src/middleware/rateLimiter.ts`
- Configuration:
  - Window: 1 minute
  - Max requests: 10 per IP
  - Message: "Too many requests, please try again later"
  - Skip successful requests: false

**B2.3: Apply to Execution Route**
- Import in `app.ts`
- Apply only to `/api/execute` endpoint
- Don't limit `/api/problems` (read-only)

**B2.4: Test Rate Limiting**
- Send 11 requests in quick succession
- Verify 11th request returns 429 status
- Wait 1 minute, verify reset

**Code Example:**
```typescript
// backend/src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';

export const executionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: 'Too many code execution requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

### Task B3: Memory Usage Tracking (Priority: Low)

**Estimated Time:** 1.5 hours

Extract actual memory usage from Docker and return in API response.

#### Implementation Plan:

**B3.1: Add Memory Extraction to dockerService.ts**
- After container execution, get container stats
- Use `container.stats({ stream: false })`
- Extract `memory_stats.usage` and `memory_stats.max_usage`
- Convert bytes to MB

**B3.2: Update ExecutionResponse**
- Change `memoryUsed: number` from placeholder to actual value
- Document unit (bytes or MB)

**B3.3: Pass Memory Through Execution Chain**
- dockerService returns memory
- executionService includes it in response
- executionController sends to frontend

**Code Example:**
```typescript
// In dockerService.ts
const stats = await container.stats({ stream: false });
const memoryUsed = stats.memory_stats.usage || 0;

return {
  ...dockerOutput,
  memoryUsed,
};
```

---

### Task B4: Logging System (Priority: Medium)

**Estimated Time:** 2 hours

Add structured logging for better debugging and monitoring.

#### Implementation Plan:

**B4.1: Install Winston**
```bash
cd backend
npm install winston
npm install --save-dev @types/winston
```

**B4.2: Create Logger Utility**
- File: `backend/src/utils/logger.ts`
- Configure Winston with:
  - Console transport (development)
  - File transport (production)
  - Log levels: error, warn, info, debug
  - Timestamp format
  - JSON format for production

**B4.3: Replace console.log**
- Replace all `console.log` with `logger.info`
- Replace all `console.error` with `logger.error`
- Add structured logging with context

**B4.4: Add Request Logging Middleware**
- Log all incoming requests with:
  - Method, path, IP
  - Response status, time taken
  - Error details if any

**Code Example:**
```typescript
// backend/src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});
```

---

### Task B5: Enhanced Error Handling (Priority: Low)

**Estimated Time:** 1 hour

Improve error messages and error categorization.

#### Implementation Plan:

**B5.1: Create Custom Error Classes**
- File: `backend/src/utils/errors.ts`
- Error types:
  - `ValidationError` (400)
  - `NotFoundError` (404)
  - `ExecutionError` (500)
  - `TimeoutError` (408)
  - `RateLimitError` (429)

**B5.2: Update Error Handler Middleware**
- Detect custom error types
- Set appropriate HTTP status codes
- Format error responses consistently

**B5.3: Use Custom Errors Throughout**
- Replace generic `throw new Error()` with specific types
- Provides better debugging information

---

### Task B6: Docker Image Health Checks (Priority: Low)

**Estimated Time:** 1 hour

Add startup verification that all Docker images are built.

#### Implementation Plan:

**B6.1: Enhance checkDockerImages()**
- Already exists in dockerService.ts
- Currently just checks availability
- Add error if critical images missing

**B6.2: Startup Validation**
- In `server.ts`, verify all images before starting server
- If images missing, print build instructions
- Option to auto-build missing images

**B6.3: Add Build Script**
- File: `backend/scripts/build-images.sh`
- Build all executor images
- Verify successful builds

---

### Task B7: Input Sanitization Improvements (Priority: High)

**Estimated Time:** 1.5 hours

Add Zod validation for all API inputs.

#### Implementation Plan:

**B7.1: Define Zod Schemas**
- File: `backend/src/models/schemas.ts`
- Schemas for:
  - ExecutionRequest
  - Problem ID parameter
  - All request bodies

**B7.2: Create Validation Middleware**
- File: `backend/src/middleware/requestValidator.ts`
- Use Zod to validate req.body
- Return 400 with detailed errors

**B7.3: Apply Validation**
- Add to execution route
- Add to problem routes if needed

**Code Example:**
```typescript
// backend/src/models/schemas.ts
import { z } from 'zod';

export const ExecutionRequestSchema = z.object({
  problemId: z.string().min(1).max(100),
  language: z.enum(['python', 'javascript', 'cpp', 'java']),
  code: z.string().min(1).max(10000),
});

// backend/src/middleware/requestValidator.ts
import { ZodSchema } from 'zod';

export const validate = (schema: ZodSchema) => {
  return (req, res, next) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      res.status(400).json({ error: error.errors });
    }
  };
};
```

---

### Task B8: Testing (Priority: Medium)

**Estimated Time:** 4 hours

Add unit and integration tests.

#### Implementation Plan:

**B8.1: Setup Testing Framework**
```bash
cd backend
npm install --save-dev jest @types/jest ts-jest supertest @types/supertest
```

**B8.2: Configure Jest**
- File: `backend/jest.config.js`
- TypeScript support with ts-jest
- Test file pattern: `**/*.test.ts`

**B8.3: Write Unit Tests**
- File: `backend/src/services/__tests__/validationService.test.ts`
  - Test deepEqual function
  - Test sanitizeResults
  - Edge cases

**B8.4: Write Integration Tests**
- File: `backend/src/__tests__/api.test.ts`
  - Test GET /api/problems
  - Test GET /api/problems/:id
  - Test POST /api/execute (with mocked Docker)

**B8.5: Add Test Scripts**
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

---

### Task B9: API Documentation (Priority: Low)

**Estimated Time:** 1.5 hours

Add OpenAPI/Swagger documentation.

#### Implementation Plan:

**B9.1: Install Swagger**
```bash
cd backend
npm install swagger-jsdoc swagger-ui-express
npm install --save-dev @types/swagger-jsdoc @types/swagger-ui-express
```

**B9.2: Create Swagger Config**
- File: `backend/src/config/swagger.ts`
- Define API info, servers, schemas

**B9.3: Add JSDoc Comments**
- Document all routes with JSDoc
- Include request/response examples

**B9.4: Serve Swagger UI**
- Route: `/api-docs`
- Interactive API explorer

---

### Task B10: Environment Configuration (Priority: Medium)

**Estimated Time:** 30 minutes

Use environment variables for configuration.

#### Implementation Plan:

**B10.1: Create .env.example**
```env
PORT=3000
NODE_ENV=development
DOCKER_HOST=unix:///var/run/docker.sock
MAX_CODE_SIZE=10000
EXECUTION_TIMEOUT=10000
MEMORY_LIMIT=268435456
CPU_LIMIT=0.5
```

**B10.2: Install dotenv**
```bash
cd backend
npm install dotenv
```

**B10.3: Create Config File**
- File: `backend/src/config/env.ts`
- Load and validate environment variables
- Export typed config object

**B10.4: Use Config Throughout**
- Replace hardcoded values
- Import from config/env.ts

---

## Priority Order Recommendation

### High Priority (Do First)
1. **B7: Input Sanitization** - Security critical
2. **B2: Rate Limiting** - Prevent abuse

### Medium Priority (Nice to Have)
3. **B4: Logging System** - Better debugging
4. **B10: Environment Configuration** - Flexibility
5. **B8: Testing** - Code quality

### Low Priority (Optional)
6. **B1: More Sample Problems** - Content expansion
7. **B3: Memory Usage Tracking** - Feature completion
8. **B5: Enhanced Error Handling** - UX improvement
9. **B6: Docker Health Checks** - DevEx improvement
10. **B9: API Documentation** - Developer documentation

---

## Testing Checklist

After completing any task, verify:

- [ ] TypeScript compiles without errors
- [ ] Server starts successfully
- [ ] All existing endpoints still work
- [ ] New functionality works as expected
- [ ] No security vulnerabilities introduced
- [ ] Code follows existing patterns
- [ ] Documentation updated

---

## Estimated Total Time

- High Priority: ~3.5 hours
- Medium Priority: ~7.5 hours
- Low Priority: ~6 hours

**Total Optional Work: ~17 hours**

**Note:** Backend is production-ready as-is. All tasks above are enhancements, not requirements.
