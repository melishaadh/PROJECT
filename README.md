# TrekEasy

Three services:

- `frontend/` — Expo / React Native app
- `backend/` — NestJS API
- `backend-database/` — Mongoose schemas, config and the (compiled-in, not
  independently run) persistence layer `backend/` imports via the `@db/*`
  path alias. The runtime "database" is MongoDB — see `docker-compose.yml` /
  `k8s/mongo-deployment.yaml`.

## Local development (without Docker)

Prerequisites: Node 18+, a local or Atlas MongoDB instance.

```bash
# Backend
cd backend
cp .env.example .env   # fill in MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npm run start:dev      # http://localhost:3001/api

# Frontend (separate shell)
cd frontend
npm install
npm run dev             # Expo dev server
```

`frontend` talks to `backend` via `EXPO_PUBLIC_API_URL` (see
`frontend/lib/apiConfig.ts`) — unset, it auto-detects the Metro dev host, so
plain `npm run dev` on a physical device on the same LAN works with no
configuration.

## Docker Compose

```bash
cp .env.example .env    # fill in JWT_SECRET, JWT_REFRESH_SECRET
docker compose up --build
```

Brings up `mongo`, `backend`, `frontend` and an `nginx` reverse proxy on
`http://localhost`. See `docker-compose.yml` and `deploy/nginx/nginx.conf`.

## Kubernetes (Minikube)

```bash
eval $(minikube docker-env)
docker build -f backend/Dockerfile -t trekeasy-backend:latest .
docker build -f backend-database/Dockerfile -t trekeasy-mongo:latest backend-database

minikube addons enable ingress
minikube addons enable metrics-server

kubectl apply -f k8s/
echo "$(minikube ip) app.local" | sudo tee -a /etc/hosts
curl http://app.local/api/health
```

See `k8s/` for the full manifest set (namespace, ConfigMap/Secret, backend
Deployment/Service/Ingress/HPA, Mongo PVC/Deployment/Service).

## CI/CD

- `.github/workflows/ci.yml` — lint/typecheck/test/build on every push and PR to `main`.
- `.github/workflows/cd.yml` — deploy on push to `main` or manual dispatch.
- `Jenkinsfile` — an equivalent 4-stage pipeline for a Jenkins-hosted setup.
