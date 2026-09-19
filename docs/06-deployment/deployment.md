# Blynk Deployment, Docker & CI/CD Architecture Guide

**Current Stage:** Stage 7 — Production Hardening & Deployment Prep  
**Architecture:** Modular Monolith (Node.js 20 LTS + TypeScript + Express + PostgreSQL + Kysely)  
**Target Workload:** Phase 1 Launch (~50 orders/day in Dharga Town hub)  

---

## 1. System Overview

Blynk utilizes a hardened, containerized **Modular Monolith** architecture designed for reproducible deployments across local development, CI test runners, and production cloud infrastructure.

```
                         ┌─────────────────────────────────┐
                         │   Blynk REST API (Express)      │
                         │   Port: 3000                    │
                         └───────────────┬─────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────┐
                         │      PostgreSQL 16 Alpine       │
                         │      Persistent Data Volume     │
                         └───────────────▲─────────────────┘
                                         │
                         ┌───────────────┴─────────────────┐
                         │  Transactional Outbox Worker    │
                         │  (Decoupled Daemon Process)     │
                         └───────────────┬─────────────────┘
                                         │
                                 ┌───────┴───────┐
                                 ▼               ▼
                             NotifyLK       WhatsApp Cloud
                               (SMS)             (API)
```

---

## 2. Multi-Stage Dockerfile Architecture

The backend API and worker use a unified, multi-stage `Dockerfile` (`backend/api/Dockerfile`) that enforces security, determinism, and minimal image footprint:

| Stage | Name | Base Image | Responsibility |
|---|---|---|---|
| 1 | `base` | `node:20-alpine` | Installs Alpine packages (`tzdata`, `wget`), configures `Asia/Colombo` timezone, sets working directory `/app`. |
| 2 | `dependencies` | `base` | Copies `package.json` and `package-lock.json`, executes deterministic `npm ci` for compilation tools. |
| 3 | `builder` | `dependencies` | Compiles TypeScript source (`tsc`) and bundles SQL migration scripts into `dist/database/migrations`. |
| 4 | `production-deps` | `base` | Installs pruned production-only runtime dependencies (`npm ci --omit=dev`). |
| 5 | `runtime` | `base` | Copies production `node_modules` and compiled `dist`, configures unprivileged user (`USER node`, uid 1000), exposes port 3000, defines `/health` container healthcheck. |

### Container Security Invariants
- **Non-Root Execution**: Runs as standard unprivileged `node` user (UID 1000).
- **No Injected Secrets**: `.env` and secret files are excluded via `.dockerignore`.
- **Minimal Surface**: No build tools, compilers, or test frameworks exist in the runtime stage.
- **Compiled JavaScript Runtime**: Executes `node dist/server.js` or `node dist/worker.js` directly; no `tsx` or `ts-node` in production.

---

## 3. Docker Compose Orchestration

Both root `docker-compose.yml` and `backend/docker-compose.yml` provide identical four-service topologies:

```yaml
services:
  postgres:   # PostgreSQL 16 Alpine with pg_isready healthcheck
  migration:  # One-shot container executing 'node dist/database/migrate.js up'
  api:        # Express REST API (depends on postgres:healthy & migration:completed)
  worker:     # Standalone Notification Outbox Worker daemon
```

### Deterministic Startup Sequence
To prevent race conditions where the API starts before the database schema exists:
1. `postgres` starts and undergoes `pg_isready -U postgres -d blynk_db` checks every 5 seconds.
2. Once healthy, `migration` runs all pending forward migrations (`001` $\rightarrow$ `002` $\rightarrow$ `003`) and exits with code 0.
3. Once `migration` completes successfully, `api` and `worker` launch in parallel.

### Decoupled Worker Process Model
- In Docker Compose, the API service sets `NOTIFICATION_WORKER_ENABLED=false` to ensure HTTP request processing is completely decoupled from outbox polling.
- The `worker` service runs `node dist/worker.js` with `NOTIFICATION_WORKER_ENABLED=true` to poll and claim outbox records without competing with HTTP request threads.

---

## 4. Environment Configuration & Invariant Validation

Runtime environment variables are validated at bootstrap using Zod schema refinement (`backend/api/src/config/env.ts`):

### Development vs Production Rules
| Configuration Key | Development / Test Default | Production Invariant (`NODE_ENV=production`) |
|---|---|---|
| `NODE_ENV` | `development` or `test` | `production` |
| `DATABASE_URL` | `postgresql://...localhost:5432/blynk_db` | Must NOT point to `localhost` or `127.0.0.1` |
| `JWT_ACCESS_SECRET` | `dev_...` (min 32 chars) | High-entropy random string; cannot start with `dev_` |
| `JWT_REFRESH_SECRET` | `dev_...` (min 32 chars) | High-entropy random string; cannot start with `dev_` |
| `OTP_SECRET` | `dev_...` (min 16 chars) | High-entropy random string; cannot start with `dev_` |
| `CORS_ORIGINS` | `*` (wildcard) | Explicit comma-separated URLs; wildcard `*` prohibited |
| `SMS_API_KEY` | Placeholder allowed (mock fallback) | Required live gateway credential; mock prohibited |
| `SMS_USER_ID` | Placeholder allowed | Required live gateway credential |

---

## 5. Graceful Shutdown & Signal Handling

Both `server.ts` and `worker.ts` intercept `SIGTERM` and `SIGINT`:
1. **HTTP Listener**: Calls `server.close()`, refusing new incoming connections while allowing in-flight requests to complete.
2. **Outbox Worker**: Calls `await notificationWorker.stop()`, clearing polling intervals and awaiting completion of currently claimed notification batches.
3. **Database Pool**: Calls `await pool.end()`, draining active PostgreSQL client connections cleanly.
4. **Safety Timeout**: A 10-second unref timer enforces hard termination if any subsystem hangs during shutdown.

---

## 6. GitHub Actions CI/CD Pipeline

Continuous Integration is automated via `.github/workflows/ci.yml`:

### Jobs:
1. **`test-and-validate`**:
   - Spins up a dedicated `postgres:16-alpine` service container with readiness checks.
   - Installs dependencies using `npm ci`.
   - Runs TypeScript typecheck: `npm run typecheck`.
   - Runs production build & migration asset bundling: `npm run build`.
   - Runs forward migrations against CI database: `npm run migrate:up:prod`.
   - Executes complete Vitest test suite: `npm test` (156 tests across 10 test suites).
2. **`docker-build-test`**:
   - Validates that `backend/api/Dockerfile` builds cleanly without pushing to an external registry.

---

## 7. Operator Runbook

### Common Commands
```bash
# Build and start all services locally in background
docker compose up --build -d

# View live container logs
docker compose logs -f api worker

# Execute database development seed in container (precompiled, requires no dev dependencies/tsx)
docker compose exec api node dist/database/seeds/dev_seed.js

# Or on local host development machine with dev dependencies:
# npm run seed (or npm run seed:prod)

# Run production migration manually
docker compose exec api node dist/database/migrate.js up

# Run database rollback
docker compose exec api node dist/database/migrate.js down

# Query health status
curl http://localhost:3000/health

# Stop all containers
docker compose down

# Wipe local database volume and re-initialize
docker compose down -v
docker compose up --build -d
```
