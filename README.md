# Online Code Judge Platform

A full-stack web application enabling users to write, compile, and execute code in multiple programming languages with real-time feedback. Built with enterprise-grade security and scalable architecture.

## Project Overview

This platform provides a LeetCode-style coding environment where users can practice algorithms and solve programming challenges. The system handles secure code execution in isolated containers, preventing malicious code execution while delivering instant results.

**Problem Solved**: Traditional online judges either lack security or require expensive infrastructure. This solution provides production-ready sandboxed execution using lightweight Docker containers.

## Key Features

### Dual Execution Modes
- **Problem Solving Mode**: Evaluate solutions against hidden test cases with detailed feedback
- **IDE Mode**: Execute custom programs with stdin/stdout for algorithm development

### Technical Capabilities
- **Multi-Language Support**: Python, JavaScript, C++, Java with extensible architecture
- **Secure Execution**: Isolated Docker containers with resource limits (CPU, memory, timeout)
- **Real-time Compilation**: Sub-second feedback with detailed error reporting
- **State Management**: Client-side persistence for seamless user experience
- **Professional IDE**: Monaco Editor integration (VSCode's editor engine)

## Architecture & Design

### System Architecture
```
React Frontend (TypeScript)
    ↓ REST API
Express Backend (TypeScript)
    ↓ Docker SDK
Isolated Execution Containers
```

### Technology Stack
- **Frontend**: React 18, TypeScript, Vite, Monaco Editor, Tailwind CSS
- **Backend**: Node.js, Express.js, TypeScript, Dockerode
- **Infrastructure**: Docker, Docker Compose
- **Security**: Container isolation, input validation, rate limiting

### Key Technical Decisions
- **Containerization**: Each execution runs in a fresh container (stateless, secure)
- **Resource Limits**: 256MB RAM, 0.5 CPU cores, 10s timeout per execution
- **Network Isolation**: Containers run with no network access
- **Parallel Execution**: Multiple test cases run concurrently for performance

## Security Implementation

Production-grade security measures:
- Network-isolated containers (--network none)
- Non-root user execution
- Memory and CPU limits enforced
- Code size validation (10KB limit)
- Execution timeouts (prevents infinite loops)
- CORS protection
- Input sanitization

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm/yarn

### Installation & Setup

```bash
# Clone repository
git clone https://github.com/avi892nash/codemare.git
cd codemare

# Install dependencies
cd frontend && npm install
cd ../backend && npm install

# Build execution containers
cd backend && docker-compose build

# Start development servers
cd backend && npm run dev  # Terminal 1 (Port 3000)
cd frontend && npm run dev # Terminal 2 (Port 5173)
```

Access application: `http://localhost:5173`

## API Design

RESTful API with comprehensive endpoints:

```
GET  /api/problems          # Retrieve all coding problems
GET  /api/problems/:id      # Get specific problem details
POST /api/execute           # Execute code against test cases
POST /api/ide/execute       # Run code with custom I/O
```

**Example Request:**
```json
POST /api/execute
{
  "problemId": "two-sum",
  "language": "python",
  "code": "def twoSum(nums, target): ..."
}
```

**Response:**
```json
{
  "success": true,
  "testResults": [...],
  "totalPassed": 5,
  "totalTests": 5,
  "executionTime": 123
}
```

## Project Highlights

- **Scalable Design**: Stateless backend enables horizontal scaling
- **Type Safety**: Full TypeScript implementation (frontend + backend)
- **Modern Tooling**: Vite for optimized builds, ESLint for code quality
- **Production Ready**: Includes Docker deployment configuration
- **Comprehensive Testing**: Postman collection with 30+ test cases

## License

MIT License - Open source and free to use

---

**Built with modern web technologies | Production-grade security | Scalable architecture**
