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
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Optional: unset means push is off (every push is a no-op) | Optional; set it to turn on app push notifications (see section 8) |

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

### Staff email + password sign-in (migration 012)

Blynk Admin, Inventory and Operations sign staff in with an email and a
password (an SMS code remains as a fallback). Only `ADMIN` and
`PACKING_STAFF` accounts with a password set can use it. The API redeploy
applies migration 012 (`staff_password_hash`, `login_failed_attempts`,
`login_locked_until`, and a unique index on `lower(email)`); if two users
already share an email in different case, the migration stops and names it -
fix those rows by hand, then redeploy.

Nobody has a password until one is set. In the Coolify Postgres console:

```sql
-- Set (or change) a staff member's email and password. bcrypt via pgcrypto;
-- only the hash is stored. Password: 8-128 characters.
UPDATE users
   SET email = lower('you@example.com'),
       staff_password_hash = crypt('YourPassword', gen_salt('bf', 10)),
       login_failed_attempts = 0,
       login_locked_until = NULL
 WHERE phone = '+94762227770'
   AND role IN ('ADMIN', 'PACKING_STAFF')
RETURNING id, phone, role, email;   -- expect exactly one row

-- Unlock early after five wrong passwords (otherwise it lifts after 15 minutes):
UPDATE users SET login_failed_attempts = 0, login_locked_until = NULL WHERE phone = '+94762227770';

-- Remove a password (that person is back to SMS codes only):
UPDATE users SET staff_password_hash = NULL WHERE phone = '+94762227770';
```

Keep real passwords out of shared history: type the statement in the console
rather than committing or pasting it into chat.

### Staff accounts and the OPERATIONS role (migration 014)

The API redeploy applies migration 014: it adds the `OPERATIONS` role and
`users.staff_disabled_at`. After that, staff accounts are created in
**Blynk Admin -> Staff accounts** (no SQL needed), and each opens one app:

| Role shown in Admin | Role in the database | Opens |
|---|---|---|
| Inventory | `PACKING_STAFF` | the Inventory site only |
| Operations | `OPERATIONS` | the Operations app only |
| Admin | `ADMIN` | everything; the only role that can create accounts |

The same page resets passwords (which also lifts a lockout), changes an
account's role, and disables or re-enables it. A disabled account cannot sign
in by password or SMS code, and its sessions end. The Admin site itself now
admits `ADMIN` accounts only; packing staff who used it for Orders must use
the Inventory site (or be given an Operations account). Existing `ADMIN`
sign-ins for the Operations app keep working.

---

## 8. Push notifications (Firebase Cloud Messaging, migration 022)

The customer app gets order updates (packed, on the way, delivered, cancelled,
couldn't deliver) and "back in stock" alerts as app push notifications, sent
through Firebase Cloud Messaging (free). The Firebase project is `blynk-15cd4`.

Two pieces of Firebase configuration exist, and they are different files:

| File | Where it goes | Secret? |
|---|---|---|
| `google-services.json` (the Android app's config) | `apps/customer/blinkit-clone-Flutter-ecommerce-/android/app/` on the machine that builds the APK. Git-ignored on purpose. | No, but keep it out of git |
| The **service-account key** (a private key) | The backend's environment, `FIREBASE_SERVICE_ACCOUNT_JSON` | **Yes** |

Without the service-account key the API and worker start normally, log once
`Push notifications disabled: FIREBASE_SERVICE_ACCOUNT_JSON is not set`, and
every push is a no-op. Without `google-services.json` the APK still builds and
runs, with push off.

### 8.1 Get the service-account key

1. Open the [Firebase console](https://console.firebase.google.com/) and pick
   the project **blynk-15cd4**.
2. Click the gear next to *Project Overview* -> **Project settings**.
3. Open the **Service accounts** tab.
4. Under *Firebase Admin SDK*, click **Generate new private key**, then
   **Generate key**. A `.json` file downloads.

That file is a password for sending pushes as Blynk. Do not commit it, email
it or paste it into chat. If it leaks, delete that key in Google Cloud console
-> IAM & Admin -> Service accounts -> the `firebase-adminsdk-...` account ->
Keys, and generate a new one.

### 8.2 Put it into Coolify

1. In Coolify open the **backend API** application -> **Environment
   Variables**.
2. Add `FIREBASE_SERVICE_ACCOUNT_JSON`. The value can be either:
   - the **whole JSON**, exactly as downloaded (open the file, select all,
     copy, paste - the value starts with `{` and ends with `}`); or
   - **base64 of the file** - the safest choice, because a one-line value
     survives every layer (Coolify, `docker-compose.yml`'s
     `${FIREBASE_SERVICE_ACCOUNT_JSON:-}` passthrough) unchanged. On Windows
     PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("key.json"))`;
     on macOS/Linux: `base64 -w0 key.json` (macOS: `base64 -i key.json`).
3. Mark it as a **secret** (lock icon / "Is secret") so Coolify hides it in the
   UI and logs.
4. If the notification worker runs as its own service (`start:worker`), add
   the same variable there too: the worker is what sends the pushes.
5. **Redeploy** the backend (and the worker). The deploy runs migration 022
   (`device_tokens`, `stock_alerts`, the `PUSH` outbox channel).
6. Check the logs: `Push notifications enabled (Firebase Cloud Messaging)`
   with `firebaseProject: "blynk-15cd4"`. A value that cannot be read logs
   `FIREBASE_SERVICE_ACCOUNT_JSON could not be read` (the key's contents are
   never logged) and push stays off.

### 8.3 How it behaves

- The app registers its FCM token after sign-in (`POST /me/devices`) and
  removes it on logout (`DELETE /me/devices/:token`). Tokens FCM reports as
  unregistered or invalid are deleted by the worker.
- Pushes go through the notifications outbox: they are queued in the same
  transaction as the order change and sent by the worker after commit, so a
  push can never block or fail an order. The delivery code is never in a push.
- "Notify me when it's back" (`POST`/`DELETE /catalog/products/:id/notify-me`)
  fires once per customer when the product is available again (switched back
  on in Ops/Admin, or tracked stock going from none to some while the product
  is on sale). While push is off, alerts stay pending.
- Android 13+ asks for notification permission after the customer places an
  order or taps "Notify me", never at first launch.
