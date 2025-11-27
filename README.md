# Codemare - Online Code Editor

A LeetCode-style online code editor platform with secure Docker-based code execution supporting Python, JavaScript, C++, and Java.

## Features

- **Multi-language Support**: Python, JavaScript, C++, and Java
- **Secure Execution**: Docker-based sandboxing with resource limits
- **Test Case Validation**: Automatic testing against visible and hidden test cases
- **Monaco Editor**: Professional code editor with syntax highlighting
- **Real-time Results**: Instant feedback on code execution
- **Problem Library**: Curated coding problems with examples and constraints

## Architecture

```
Frontend (React + TypeScript + Monaco Editor)
    ↓ HTTP/REST API
Backend (Express + TypeScript)
    ↓ Docker API
Isolated Execution Containers (Python/JS/C++/Java)
```

## Tech Stack

### Frontend
- React 18+ with TypeScript
- Vite (build tool)
- Monaco Editor (code editor)
- Tailwind CSS (styling)
- Axios (HTTP client)

### Backend
- Node.js 20+ with Express
- TypeScript
- Dockerode (Docker SDK)
- Docker for code execution

### Infrastructure
- Docker & Docker Compose
- Python 3.11 Alpine
- Node 20 Alpine
- GCC 13 Alpine
- OpenJDK 21 Slim

## Project Structure

```
codemare/
├── frontend/           # React + TypeScript frontend
├── backend/            # Express + TypeScript backend
│   ├── src/
│   │   ├── controllers/    # API controllers
│   │   ├── services/       # Business logic
│   │   ├── models/         # Type definitions
│   │   ├── routes/         # API routes
│   │   └── data/problems/  # Problem definitions
├── docker/             # Executor images
│   ├── python-executor/
│   ├── javascript-executor/
│   ├── cpp-executor/
│   └── java-executor/
└── docker-compose.yml
```

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose
- Git

### Installation

1. **Clone the repository**
   ```bash
   cd codemare
   ```

2. **Install dependencies**
   ```bash
   # Frontend
   cd frontend && npm install

   # Backend
   cd ../backend && npm install
   ```

3. **Build Docker executor images**
   ```bash
   cd ..
   docker-compose build
   ```

4. **Start all services**
   ```bash
   docker-compose up
   ```

   Or run individually:
   ```bash
   # Terminal 1: Backend
   cd backend && npm run dev

   # Terminal 2: Frontend
   cd frontend && npm run dev
   ```

5. **Access the application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3000
   - Health Check: http://localhost:3000/health

## API Endpoints

### Problems
- `GET /api/problems` - Get all problems
- `GET /api/problems/:id` - Get specific problem

### Code Execution
- `POST /api/execute` - Execute code with test cases

**Request body:**
```json
{
  "problemId": "two-sum",
  "language": "python",
  "code": "def twoSum(nums, target):\n    # solution here"
}
```

**Response:**
```json
{
  "success": true,
  "testResults": [...],
  "totalPassed": 5,
  "totalTests": 5,
  "executionTime": 123,
  "memoryUsed": 0
}
```

## Security Features

### Docker Isolation
- Network isolation (`--network none`)
- Memory limits (256MB per container)
- CPU limits (0.5 cores per container)
- Process limits (max 50 processes)
- Execution timeout (10 seconds)
- Non-root user execution
- Read-only filesystem where possible
- No privilege escalation

### Input Validation
- Code size limits (<10KB)
- Input sanitization
- Type validation with TypeScript/Zod
- Hidden test cases protected

## Development

### Testing Locally

1. **Test backend API**
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/api/problems
   ```

2. **Test code execution**
   ```bash
   curl -X POST http://localhost:3000/api/execute \
     -H "Content-Type: application/json" \
     -d '{
       "problemId": "two-sum",
       "language": "python",
       "code": "def twoSum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i+1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]"
     }'
   ```

### Adding New Problems

1. Create a new JSON file in `backend/src/data/problems/`
2. Follow the structure of existing problems (two-sum.json, reverse-string.json)
3. Add the problem to `index.json`
4. Restart the backend

### Project Status

**Completed:**
- ✅ Backend API with code execution
- ✅ Docker-based sandboxing for 4 languages
- ✅ Security measures and resource limits
- ✅ Sample problems (Two Sum, Reverse String)
- ✅ Frontend scaffolding with Vite + React

**TODO:**
- ⏳ Monaco Editor integration
- ⏳ Frontend UI components
- ⏳ Problem list and navigation
- ⏳ Results display with test cases
- ⏳ Error handling and user feedback
- ⏳ More sample problems

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License

## Author

Built with Claude Code
