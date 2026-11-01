# Rendly MVP - Complete Microservice Architecture

**Tagline:** Know Your Why, Find Your Who

## Project Structure

- `frontend/` - Next.js React frontend application
- `backend/` - Node.js microservices backend
  - `services/` - Individual microservices
  - `shared/` - Shared utilities and types
  - `config/` - Configuration files

## Features

### Chat: 15-day visible window and 30-day retention cycle

The chat system (Whispers, Groups, and notes-to-self “You”) uses a fixed visible window and an automatic retention cycle so users see a consistent, recent history while keeping storage small and predictable.

| Aspect | Behaviour |
|--------|-----------|
| **Visible in chat** | Only the **last 15 days** of messages are returned by the API (today and the previous 14 days). This applies to You (self), Whispers, and Groups. |
| **Stored in DB and JSON** | Messages are kept for the **last 30 days** (days 1–30 counting back from today). |
| **Auto-delete** | A scheduled job runs on chat-service startup and every 24 hours. It deletes all messages older than 30 days from the database and from the Storage JSON files. |

**How the window moves**

- The 15-day window is rolling: as each new day starts, “today” becomes the latest day and the oldest day in the window (the 15th day back) leaves the visible set.
- Users always see “up to the last 15 days” of messages; older messages are no longer returned by the API.
- Once a message is older than 30 days, it is removed from both the database and Storage so the system runs in a repeating cycle: show 15 days, retain 30 days, then delete what is past 30 days.

## Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Git

### Installation

1. Clone repository:
```bash
git clone <repo>
cd rendly-mvp
```

2. Setup environment:
```bash
cp .env.example .env
# Update .env with your credentials
```

3. Install dependencies:

**Frontend:**
```bash
cd frontend
npm install
```

**Backend:**
```bash
cd backend
npm install
```

### Development

Start infrastructure and backend services (run from backend directory):
```bash
cd backend
docker-compose up -d
npm run dev
```

Start frontend:
```bash
cd frontend
npm run dev
```

Frontend: http://localhost:3001
API Gateway: http://localhost:80 (when running docker-compose from backend/)

### Services

- Auth Service: :4001 (login, JWT, OAuth, /api/users)
- User Service: :3002
- Matching Service: :3003
- **Chat Service:** :4002 (REST + Socket.IO: conversations, messages, real-time delivery)
- Video Service: :3005
- Moderation Service: :3006
- Huddle Service: :3007
- Admin Service: :3008
- API Gateway: :80

**Chat (local dev):** For the dashboard chat to persist messages and real-time updates, run:
- **Chat-service** on port 4002 (REST + Socket.IO on the same port).

The frontend uses `http://localhost:4002` for REST and `ws://localhost:4002` for Socket.IO. Override with `NEXT_PUBLIC_CHAT_API_URL` and `NEXT_PUBLIC_CCS_WS_URL` in the frontend `.env` if needed.

### Building
```bash
# Frontend
cd frontend && npm run build

# Backend
cd backend && npm run build
```

### Deployment
```bash
cd backend
docker-compose -f docker-compose.yml up -d
```

## License

MIT
