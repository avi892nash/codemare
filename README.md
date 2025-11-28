# Codemare - Online Code Editor & Judge Platform

A LeetCode-style online code editor platform with secure Docker-based code execution supporting Python, JavaScript, C++, and Java.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)

## ✨ Features

### 🎯 Dual Mode Interface
- **Problem Mode**: LeetCode-style problem solving with test cases
- **IDE Mode**: Free-form code playground with custom stdin/stdout test cases
- **State Persistence**: All code, test cases, and app state saved in localStorage

### 💻 Code Execution
- **Multi-language Support**: Python, JavaScript, C++, and Java
- **Secure Execution**: Docker-based sandboxing with resource limits
- **Test Case Validation**: Automatic testing against visible and hidden test cases
- **Real-time Results**: Instant feedback with execution time and memory usage
- **IDE Execution**: Run code with custom stdin/stdout test cases

### 🎨 User Experience
- **Monaco Editor**: Professional code editor with syntax highlighting
- **Auto-save**: Code automatically saved to localStorage every 500ms
- **Per-Language Storage**: Each language maintains separate code
- **Problem Code Storage**: Your solutions saved per problem/language
- **Template Code**: Start with helpful templates in IDE mode

### 📚 Problem Library
- Curated coding problems with examples and constraints
- Multiple difficulty levels (Easy, Medium, Hard)
- Hidden test cases for validation
- Starter code for all languages

## 🏗️ Architecture

```
Frontend (React + TypeScript + Monaco Editor)
    ↓ HTTP/REST API
Backend (Express + TypeScript)
    ↓ Docker API
Isolated Execution Containers (Python/JS/C++/Java)
```

## 🛠️ Tech Stack

### Frontend
- React 18+ with TypeScript
- Vite (build tool)
- Monaco Editor (code editor)
- Tailwind CSS (styling)
- Axios (HTTP client)
- localStorage (state persistence)

### Backend
- Node.js 20+ with Express
- TypeScript
- Dockerode (Docker SDK)
- Docker for code execution
- Zod (validation)

### Infrastructure
- Docker & Docker Compose
- Python 3.11 Alpine
- Node 20 Alpine
- GCC 13 Alpine
- OpenJDK 21 Slim

## 📁 Project Structure

```
codemare/
├── frontend/                # React + TypeScript frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── Editor/     # Code editor components
│   │   │   ├── IDE/        # IDE mode components
│   │   │   ├── Problem/    # Problem solving components
│   │   │   ├── Results/    # Test results display
│   │   │   └── Layout/     # Navigation and layout
│   │   ├── hooks/          # Custom React hooks
│   │   ├── context/        # React context (state management)
│   │   ├── services/       # API services
│   │   ├── types/          # TypeScript types
│   │   ├── utils/          # Utility functions (localStorage)
│   │   └── constants/      # IDE templates
├── backend/                # Express + TypeScript backend
│   ├── src/
│   │   ├── controllers/    # API controllers
│   │   ├── services/       # Business logic (execution, Docker)
│   │   ├── models/         # Type definitions
│   │   ├── routes/         # API routes
│   │   └── data/problems/  # Problem definitions
│   ├── docker/             # Executor images
│   │   ├── python-executor/
│   │   ├── javascript-executor/
│   │   ├── cpp-executor/
│   │   └── java-executor/
│   └── postman/            # API testing collection
└── docker-compose.yml
```

## 🚀 Getting Started

### Prerequisites

- Node.js 20+ and npm
- Docker and Docker Compose
- Git

### Quick Start (Development)

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/codemare.git
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
   cd backend
   docker-compose build
   ```

4. **Start development servers**
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

## 📡 API Endpoints

### Problems
- `GET /api/problems` - Get all problems
- `GET /api/problems/:id` - Get specific problem

### Code Execution (Problem Mode)
- `POST /api/execute` - Execute code against problem test cases

**Request:**
```json
{
  "problemId": "two-sum",
  "language": "python",
  "code": "def twoSum(nums, target):\n    # solution"
}
```

**Response:**
```json
{
  "success": true,
  "testResults": [
    {
      "input": [[2, 7, 11, 15], 9],
      "expectedOutput": [0, 1],
      "actualOutput": [0, 1],
      "passed": true,
      "executionTime": 45
    }
  ],
  "totalPassed": 5,
  "totalTests": 5,
  "executionTime": 123,
  "memoryUsed": 0
}
```

### IDE Execution
- `POST /api/ide/execute` - Execute code with custom stdin/stdout test cases

**Request:**
```json
{
  "code": "a, b = map(int, input().split())\nprint(a + b)",
  "language": "python",
  "testCases": [
    { "input": "2 3", "expectedOutput": "5" },
    { "input": "10 20", "expectedOutput": "30" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "testResults": [
    {
      "input": "2 3",
      "expectedOutput": "5",
      "actualOutput": "5\n",
      "passed": true,
      "executionTime": 342
    }
  ],
  "totalPassed": 2,
  "totalTests": 2,
  "totalExecutionTime": 684
}
```

## 🔒 Security Features

### Docker Isolation
- Network isolation (`--network none`)
- Memory limits (256MB per container)
- CPU limits (0.5 cores per container)
- Process limits (max 50 processes)
- Execution timeout (10 seconds)
- Non-root user execution
- Read-only filesystem where possible
- No privilege escalation
- Temporary containers (auto-removed)

### Input Validation
- Code size limits (<10KB)
- Test case limits (max 10 for IDE)
- Input sanitization
- Type validation with Zod
- Hidden test cases protected
- CORS protection
- Rate limiting

## 💾 State Persistence

All state is automatically saved to localStorage:

### IDE Mode
- **Per-language code**: Each language (Python, JS, C++, Java) has separate code
- **Test cases**: Custom test cases for each language
- **Auto-save**: Debounced 500ms after changes

### Problem Mode
- **Per-problem/language code**: Each problem remembers code for each language
- **Selected problem**: Restores last problem on refresh
- **Selected language**: Remembers language preference

### App State
- **Current mode**: Returns to IDE or Problem mode
- **All preserved on refresh**: Full state restoration

**localStorage keys:**
- `codemare_ide_state` - IDE code and test cases
- `codemare_app_state` - Mode, language, problem, problem code

## 🧪 Testing

### API Testing with Postman

Import the collection:
```bash
backend/postman/Codemare_API.postman_collection.json
backend/postman/Codemare_Environment.postman_environment.json
```

### Manual Testing

```bash
# Health check
curl http://localhost:3000/health

# Get problems
curl http://localhost:3000/api/problems

# Execute code (Problem mode)
curl -X POST http://localhost:3000/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "python",
    "code": "def twoSum(nums, target):\n    seen = {}\n    for i, num in enumerate(nums):\n        complement = target - num\n        if complement in seen:\n            return [seen[complement], i]\n        seen[num] = i\n    return []"
  }'

# Execute code (IDE mode)
curl -X POST http://localhost:3000/api/ide/execute \
  -H "Content-Type: application/json" \
  -d '{
    "code": "a, b = map(int, input().split())\nprint(a + b)",
    "language": "python",
    "testCases": [
      {"input": "2 3", "expectedOutput": "5"}
    ]
  }'
```

## 🌐 Deployment

### Quick Local Production

```bash
# Backend
cd backend
cp .env.production .env
./deploy.sh

# Frontend
cd frontend
npm run build
npm run preview
```

### VPS Deployment (DigitalOcean, AWS EC2, Linode)

**Full guide with step-by-step instructions:**

#### 1. Server Setup
```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install Nginx
apt install nginx -y

# Install Certbot (SSL)
apt install certbot python3-certbot-nginx -y
```

#### 2. Deploy Backend
```bash
cd /var/www/codemare/backend

# Create .env
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
DOCKER_HOST=unix:///var/run/docker.sock
ALLOWED_ORIGINS=https://your-domain.com
LOG_LEVEL=info
EOF

# Deploy
./deploy.sh
```

#### 3. Deploy Frontend
```bash
cd /var/www/codemare/frontend

# Create production env
cat > .env.production << 'EOF'
VITE_API_URL=https://api.your-domain.com
EOF

# Build
npm install && npm run build

# Copy to nginx
cp -r dist/* /var/www/html/
```

#### 4. Configure Nginx
```bash
# Create nginx config
cat > /etc/nginx/sites-available/codemare << 'EOF'
# Frontend
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Backend API
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 60s;
    }
}
EOF

# Enable and reload
ln -s /etc/nginx/sites-available/codemare /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

#### 5. Setup SSL
```bash
certbot --nginx -d your-domain.com -d api.your-domain.com
```

### Cloud Platform Deployment

#### Railway.app (Easiest)
1. Connect GitHub repo
2. Add backend service
3. Environment variables:
   ```
   NODE_ENV=production
   PORT=3000
   ALLOWED_ORIGINS=https://your-frontend.vercel.app
   ```
4. Auto-deploy ✅

#### Vercel (Frontend)
```bash
cd frontend
npm i -g vercel
vercel

# Environment variable:
# VITE_API_URL=https://your-backend.railway.app
```

#### Render.com
- Backend: Docker service (auto-detects Dockerfile)
- Frontend: Static site (build: `npm run build`, output: `dist`)

#### DigitalOcean App Platform
- Import GitHub repo
- Backend: Detected as Dockerfile
- Frontend: Static site component

### Environment Configuration

**Backend `.env`:**
```bash
NODE_ENV=production
PORT=3000
DOCKER_HOST=unix:///var/run/docker.sock
ALLOWED_ORIGINS=https://your-domain.com
LOG_LEVEL=info
```

**Frontend `.env.production`:**
```bash
VITE_API_URL=https://api.your-domain.com
```

## 🔧 Development

### Adding New Problems

1. Create JSON file in `backend/src/data/problems/`
2. Follow structure of existing problems
3. Add to `index.json`
4. Restart backend

### Project Status

**✅ Completed:**
- Backend API with code execution
- Docker-based sandboxing for 4 languages
- Security measures and resource limits
- Problem mode with test case validation
- IDE mode with stdin/stdout execution
- Full frontend UI with Monaco Editor
- Problem list and navigation
- Results display with test cases
- Error handling and user feedback
- localStorage persistence for all state
- Mode switching (Problem/IDE)
- Per-language code storage
- Auto-save functionality
- Template code for IDE
- Output comparison normalization

**🚀 Future Enhancements:**
- User authentication and accounts
- Problem submission history
- Leaderboard and rankings
- Discussion forums
- More sample problems
- Code sharing
- Real-time collaboration
- Analytics dashboard

## 🐛 Troubleshooting

### Backend Issues
```bash
# Check logs
docker-compose -f docker-compose.production.yml logs -f backend

# Restart backend
cd backend && ./deploy.sh
```

### Frontend Issues
- Check browser console for errors
- Verify `VITE_API_URL` in `.env.production`
- Rebuild: `npm run build`

### CORS Errors
Update `backend/.env`:
```bash
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

### Code Execution Fails
```bash
# Check executor images
docker images | grep executor

# Rebuild
cd backend
docker-compose -f docker-compose.production.yml build --no-cache
```

## 📊 Performance

- **Frontend**: Optimized Vite build with code splitting
- **Backend**: Stateless API for horizontal scaling
- **Execution**: Parallel test case execution
- **Caching**: Template code cached in constants
- **Debouncing**: 500ms save debounce to reduce writes

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 👏 Acknowledgments

- Built with [Claude Code](https://claude.com/claude-code)
- Powered by Docker
- UI inspired by LeetCode

---

**🎉 Star this repo if you find it useful!**
