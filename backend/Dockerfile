# NestJS API service.
#
# Build context is the REPO ROOT, not backend/ — `backend/tsconfig.json`
# compiles with `rootDir: ".."` so the emitted output mirrors
# `dist/backend/src/` + `dist/backend-database/`, per backend/src/register-aliases.ts.
# See docker-compose.yml, which sets `context: .` / `dockerfile: backend/Dockerfile`.
#
#   docker build -f backend/Dockerfile -t trekeasy-backend .

# ── deps ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend ./backend
COPY backend-database ./backend-database
WORKDIR /app/backend
RUN npm run build

# ── production deps only ────────────────────────────────────────────────
FROM node:20-alpine AS prod-deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S trekeasy && adduser -S trekeasy -G trekeasy
WORKDIR /app

COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json

# Uploads fallback dir (see backend/src/common/storage.service.ts) — created
# up front so a non-root process can write to it without a first-run failure.
RUN mkdir -p /app/backend/uploads && chown -R trekeasy:trekeasy /app/backend

USER trekeasy
WORKDIR /app/backend
EXPOSE 3001

#
# GET /api/health always answers 200 (see HealthService — a transient DB
# reconnect must not crash-loop the container), with the real state in the
# JSON body's `status` field. Compose's `service_healthy` gate reads *this*
# (rather than a plain HTTP-status check) so `frontend`/`nginx` wait for an
# actual Mongo connection, not just a listening process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "\
    require('http').get('http://127.0.0.1:3001/api/health', r => { \
      let body = ''; r.on('data', c => body += c); \
      r.on('end', () => { \
        try { process.exit(JSON.parse(body).status === 'ok' ? 0 : 1); } \
        catch { process.exit(1); } \
      }); \
    }).on('error', () => process.exit(1))"

CMD ["node", "dist/backend/src/main"]
