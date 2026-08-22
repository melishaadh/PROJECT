# TrekEasy

A trek-discovery app for the Himalayas: personalized recommendations, live trending, and group chat per expedition.

Three independent services:

| Service | Path | What it is |
|---|---|---|
| **Frontend** | [`frontend/`](frontend) | Expo / React Native app (iOS, Android, web) |
| **Backend** | [`backend/`](backend) | NestJS REST + WebSocket API |
| **Backend-database** | [`backend-database/`](backend-database) | Mongoose schemas, DB & JWT config, shared by `backend/`. Not a server itself — MongoDB is the actual database service (see [Docker Compose](#docker-compose) / [Kubernetes](#kubernetes-minikube)) |

```
Browser / Mobile app
        │
        ▼
   nginx (:80)  ──────────────►  frontend (Expo web export, :8080)
        │
        └── /api ─────────────►  backend (NestJS, :3001)
                                       │
                                       ▼
                                  mongo (:27017)
```

`backend/` imports `backend-database/`'s schemas via the `@db/*` TypeScript path alias (see `backend/tsconfig.json`) — they compile together but stay in separate directories so the persistence layer can be reasoned about (and reused) on its own.

---

## Prerequisites

- Node.js 18+ and npm
- A MongoDB instance — local, [Atlas](https://www.mongodb.com/atlas), or via Docker (below)
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose, for the containerized setup
- [Minikube](https://minikube.sigs.k8s.io/) + `kubectl`, for the Kubernetes setup

## Environment variables

Copy the example file for whichever way you're running things and fill in the blanks:

| File | Used by |
|---|---|
| `backend/.env.example` → `backend/.env` | running `backend/` directly with `npm run start:dev` |
| `.env.example` → `.env` | `docker compose up` |

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Meaning |
|---|---|
| `MONGODB_URI` / `MONGO_DB_NAME` | Where the database lives |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Auth token signing keys — required, 32+ chars |
| `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | Token lifetimes (default `15m` / `30d`) |
| `PORT` | Backend port (default `3001`) |
| `CORS_ORIGINS` | Comma-separated allowed origins. Blank when nginx serves both frontend and API from one origin |
| `TRUST_PROXY` | `true` when running behind nginx/an ingress, so rate limiting sees the real client IP |
| `EXPO_PUBLIC_API_URL` | Where the frontend looks for the API. Baked into the frontend build — see [`frontend/lib/apiConfig.ts`](frontend/lib/apiConfig.ts) |
| `CLOUDINARY_*` | Optional — profile picture storage. Unset falls back to local disk |

---

## Run it locally (no Docker)

```bash
# 1. Backend
cd backend
cp .env.example .env      # fill in MONGODB_URI, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npm run start:dev         # → http://localhost:3001/api

# 2. Frontend, in a second terminal
cd frontend
npm install
npm run dev                # → Expo dev server
```

The frontend auto-detects the backend's LAN address if `EXPO_PUBLIC_API_URL` is unset, so a phone on the same Wi-Fi running Expo Go works with no extra configuration.

Useful backend scripts (run from `backend/`): `npm run seed:destinations`, `npm run test`, `npm run typecheck`, `npm run lint`.

## Docker Compose

Brings up all four services — `mongo`, `backend`, `frontend`, and an `nginx` reverse proxy — in one command.

```bash
cp .env.example .env       # fill in JWT_SECRET, JWT_REFRESH_SECRET
docker compose up --build
```

Then open **http://localhost**. nginx routes `/` to the frontend and `/api` to the backend (see [`deploy/nginx/nginx.conf`](deploy/nginx/nginx.conf)).

```bash
docker compose down          # stop
docker compose down -v       # stop and wipe the Mongo volume
docker compose logs -f backend
```

An Apache alternative to nginx is provided at [`deploy/apache/`](deploy/apache) for on-prem hosting of the frontend build.

## Kubernetes (Minikube)

```bash
# 1. Build the images into Minikube's own Docker daemon
eval $(minikube docker-env)
docker build -f backend/Dockerfile -t trekeasy-backend:latest .
docker build -f frontend/Dockerfile -t trekeasy-frontend:latest frontend
docker build -f backend-database/Dockerfile -t trekeasy-mongo:latest backend-database

# 2. Enable required addons
minikube addons enable ingress
minikube addons enable metrics-server

# 3. Apply the manifests
kubectl apply -f k8s/

# 4. Point app.local at Minikube
echo "$(minikube ip) app.local" | sudo tee -a /etc/hosts

# 5. Verify
kubectl get pods -n myapp
curl http://app.local/api/health
```

Manifests, all under [`k8s/`](k8s):

| File | What it creates |
|---|---|
| `namespace.yaml` | the `myapp` namespace |
| `app-config.yaml`, `db-secret.yaml` | non-secret / secret env vars for the backend |
| `backend-deployment.yaml`, `backend-service.yaml`, `ingress.yaml` | the API, exposed via NodePort and Ingress |
| `mongo-pvc.yaml`, `mongo-deployment.yaml`, `mongo-service.yaml` | MongoDB with persistent storage |
| `backend-hpa.yaml` | autoscales the backend 2→6 pods on CPU |

**Rolling updates & rollback** — any change to `backend-deployment.yaml`'s pod spec (e.g. a new `image:` tag) triggers a rolling update automatically:

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl rollout status deployment/backend -n myapp
kubectl rollout undo deployment/backend -n myapp   # revert if something's wrong
```

---

## CI/CD

- **`.github/workflows/ci.yml`** — runs on every push and on PRs into `main`: lint, typecheck, test, build, for both services across Node 18 and 20, with build artifacts uploaded.
- **`.github/workflows/cd.yml`** — runs on push to `main` (or manually via *Run workflow* with a `staging`/`production` choice): re-runs tests, builds both Docker images, deploys, then posts a success/failure message to **#trekeasy** in Slack.

  To enable the Slack step, add a repository secret named `SLACK_WEBHOOK_URL` (**Settings → Secrets and variables → Actions → New repository secret**) with your [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks) URL. The workflow never contains the URL itself.

- **`Jenkinsfile`** — an equivalent pipeline (`Checkout` → `Build` → `Test` → `Archive`) for a Jenkins-hosted setup, with a Node 20 tool named `node20` expected to be configured in Jenkins.

---

## Project structure

```
frontend/            Expo app — screens/, components/, lib/, context/
backend/              NestJS API — src/modules/{auth,users,destinations,chat,...}
backend-database/     Mongoose schemas + config, imported by backend/ via @db/*
deploy/               nginx.conf, Apache vhost + .htaccess
k8s/                  Kubernetes manifests
.github/workflows/    CI and CD
Jenkinsfile
docker-compose.yml
```

## Notable API endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/register`, `/api/auth/login` | |
| `GET` | `/api/users/me` | current user's profile |
| `PATCH` | `/api/users/me`, `/api/users/profile` | edit identity / preferences |
| `DELETE` | `/api/users/account` | **permanently deletes the account** — password-confirmed, removes likes/interactions, stored profile picture, and all sessions |
| `GET` | `/api/health` | used by every health/readiness check in this repo |

Account deletion also has a UI trigger: **Profile → Danger Zone → Delete Account**.
