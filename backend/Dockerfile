# Build context is the repo root (not backend/), because backend/tsconfig.json
# compiles backend/ and backend-database/ together:
#   docker build -f backend/Dockerfile -t trekeasy-backend .

FROM node:20-alpine AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json backend/
RUN npm ci --prefix backend
COPY backend backend
COPY backend-database backend-database
RUN npm run build --prefix backend

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist ./dist
COPY backend/global-bundle.pem ./global-bundle.pem

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:3001/api/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "dist/backend/src/main"]
