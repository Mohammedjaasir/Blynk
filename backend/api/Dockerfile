# ==============================================================================
# BLYNK QUICK-COMMERCE BACKEND API - PRODUCTION MULTI-STAGE DOCKERFILE
# ==============================================================================
# Architecture: Modular Monolith (Node.js 20 LTS + TypeScript + Express + PostgreSQL)
# Security: Minimal Alpine Linux, Non-Root User (node:1000), Zero Secrets Baked In
# Stages:
#   1. base            - Minimal Alpine runtime foundation with Asia/Colombo timezone
#   2. dependencies    - Full dependency installation for build & compilation
#   3. builder         - TypeScript compiler (tsc) & database migration asset bundling
#   4. production-deps - Pruned production-only node_modules
#   5. runtime         - Hardened, non-root production container
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Base Alpine Runtime Environment
# ------------------------------------------------------------------------------
FROM node:20-alpine AS base

# Install timezone data for Sri Lanka (Asia/Colombo) operating hours
RUN apk add --no-cache tzdata wget
ENV TZ=Asia/Colombo

WORKDIR /app

# ------------------------------------------------------------------------------
# Stage 2: Development & Build Dependencies
# ------------------------------------------------------------------------------
FROM base AS dependencies

COPY package.json package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 3: Source Compilation & Asset Bundling
# ------------------------------------------------------------------------------
FROM dependencies AS builder

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 4: Production Dependencies Only (Pruned)
# ------------------------------------------------------------------------------
FROM base AS production-deps

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------------------------
# Stage 5: Final Hardened Production Runtime
# ------------------------------------------------------------------------------
FROM base AS runtime

# Runtime Environment Defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV API_PREFIX=/api/v1
ENV APP_NAME=blynk-backend-api

# Security: Run as unprivileged standard non-root user (node:node, uid/gid 1000)
USER node

# Copy production artifacts with non-root ownership
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=production-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# Document exposed HTTP API port
EXPOSE 3000

# Container Healthcheck (queries existing /health endpoint with database connectivity check)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Default command: Start Express API server (or override with `node dist/worker.js` for worker)
CMD ["node", "dist/server.js"]
