# Codemare

A LeetCode-style online code editor platform with secure Docker-based execution supporting Python, JavaScript, C++, and Java.

## Features

- **Dual Mode**: Problem-solving mode with test cases + IDE mode with custom stdin/stdout
- **Multi-language**: Python, JavaScript, C++, Java
- **Secure Execution**: Docker sandboxing with resource limits
- **State Persistence**: LocalStorage for code, test cases, and app state
- **Monaco Editor**: Professional code editor with syntax highlighting

## Tech Stack

**Frontend**: React 18, TypeScript, Vite, Monaco Editor, Tailwind CSS
**Backend**: Node.js 20, Express, TypeScript, Dockerode
**Infrastructure**: Docker, Docker Compose

## Quick Start

```bash
# Install dependencies
cd frontend && npm install
cd ../backend && npm install

# Build Docker executors
cd backend && docker-compose build

# Start servers
cd backend && npm run dev  # Terminal 1
cd frontend && npm run dev  # Terminal 2
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

## API Endpoints

- `GET /api/problems` - List all problems
- `GET /api/problems/:id` - Get problem details
- `POST /api/execute` - Execute code (Problem mode)
- `POST /api/ide/execute` - Execute code (IDE mode with stdin/stdout)

## Security

- Docker isolation (no network, memory/CPU limits, non-root execution)
- Input validation (code size, test case limits)
- Execution timeout (10s)
- CORS protection & rate limiting

## License

MIT
