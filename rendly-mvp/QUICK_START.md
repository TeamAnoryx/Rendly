# Rendly MVP - Quick Start Guide

**Tagline:** Know Your Why, Find Your Who

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (optional but recommended)
- Git
- 8GB RAM minimum

## Option 1: Automated Setup (Recommended)

### macOS/Linux

```bash
cd rendly-mvp
bash scripts/setup.sh
bash scripts/docker-start.sh   # Terminal 1
bash scripts/backend-dev.sh    # Terminal 2
bash scripts/frontend-dev.sh   # Terminal 3
```

### Windows PowerShell

```powershell
cd rendly-mvp
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
docker-compose -f backend/docker-compose.yml up -d   # Terminal 1
cd backend; npm run dev   # Terminal 2
cd frontend; npm run dev  # Terminal 3
```

## Option 2: Manual Setup

### 1. Install Dependencies

```bash
# Backend
cd backend && npm run install:services

# Frontend
cd frontend && npm install
```

### 2. Start Database & Cache

```bash
docker-compose -f backend/docker-compose.yml up -d
```

### 3. Start Services

```bash
# Terminal 1: Backend
cd backend && npm run dev   # starts all services; check with: npm run status

# Terminal 2: Frontend
cd frontend && npm run dev
```

## Access Points

| Service            | URL                  |
|--------------------|----------------------|
| Frontend           | http://localhost:3001 |
| API Gateway        | http://localhost:80   |
| Auth Service       | http://localhost:4001 |
| User Service       | http://localhost:3002 |
| Matching Service   | http://localhost:3003 |
| Chat Service (REST + Socket.IO) | http://localhost:4002 |
| Video Service      | http://localhost:3005 |
| Moderation Service | http://localhost:3006 |
| Huddle Service     | http://localhost:3007 |
| Admin Service      | http://localhost:3008 |

## Docker Commands

```bash
# Start containers
docker-compose -f backend/docker-compose.yml up -d

# View logs
docker-compose -f backend/docker-compose.yml logs -f [service]

# Stop containers
docker-compose -f backend/docker-compose.yml down

# Reset database
docker-compose -f backend/docker-compose.yml down -v
```

## Troubleshooting

### Port Already in Use

```bash
# Find process using port (Linux/macOS)
lsof -i :3000

# Kill process
kill -9 [PID]
```

On Windows:

```powershell
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### Database Connection Error

- Ensure Docker is running: `docker ps`
- Verify `backend/.env` has correct `DATABASE_URL`

### Node Modules Issues

```bash
rm -rf node_modules
npm install
```

## Next Steps

1. Update `backend/.env` with your OAuth credentials
2. Create a test user account
3. Test 1:1 chat and video
4. Test group huddles
5. Run admin dashboard

## Getting Help

- Check logs: `docker-compose -f backend/docker-compose.yml logs -f [service]`
- Review documentation in repo root
- Debug frontend: http://localhost:3001 (DevTools)
