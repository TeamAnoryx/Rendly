# Rendly Backend

**Tagline:** Know Your Why, Find Your Who

Microservices: auth, user, matching, video, moderation, huddle, admin.

Run from this directory:
- `docker-compose up -d` - start Postgres, Redis, and all services
- `npm run install:services` - install dependencies for each service
- `npm run dev` - start all services in the background (logs in `backend/.run/logs/`)
- `npm run status` - check each service's `/health`
- `npm run stop` - stop them
