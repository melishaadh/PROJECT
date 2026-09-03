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
  nginx (:80) / Ingress  ─────►  frontend (Expo web export, :8080)
        │
        ├── /api ────────────►  backend (NestJS, :3001)
        ├── /uploads ────────►  backend   (locally-stored images)
        └── /socket.io ──────►  backend   (real-time chat WebSocket)
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
| `CORS_ORIGINS` | Comma-separated allowed origins. Set to the host the browser loads the app from (`http://localhost` for Compose, `http://app.local` for the Ingress) — with `NODE_ENV=production` a blank value blocks all cross-origin calls and the chat socket handshake |
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

Then open **http://localhost**. nginx routes `/` to the frontend and `/api` to the backend (see [`deploy/nginx/nginx.conf`](deploy/nginx/nginx.conf)), and answers `/healthz` with `trekeasy-nginx ok` so you can tell "the proxy is serving port 80" apart from "something else is".

If you reach the app by IP instead of `localhost`, add that origin to `CORS_ORIGINS` in `.env` or the chat socket handshake will be refused.

That config is **copied into the `trekeasy-nginx` image**, not bind-mounted, so edits to it need a rebuild: `docker compose up -d --build nginx`.

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
docker build -f frontend/Dockerfile --build-arg EXPO_PUBLIC_API_URL=/api -t trekeasy-frontend:latest frontend
docker build -f backend-database/Dockerfile -t trekeasy-database:latest backend-database

# 2. Enable required addons
minikube addons enable ingress
minikube addons enable metrics-server

# 3. Apply the manifests
kubectl apply -f k8s/
# If you applied an earlier revision, drop the renamed Ingress:
#   kubectl delete ingress backend-ingress -n myapp --ignore-not-found

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
| `backend-deployment.yaml`, `backend-service.yaml` | the API (NodePort `30081` for direct access) |
| `frontend-deployment.yaml`, `frontend-service.yaml` | the Expo web bundle (ClusterIP, reached only via the Ingress) |
| `ingress.yaml` | `trekeasy-ingress` — single front door on `app.local`, routes `/api` + `/uploads` + `/socket.io` to the backend and `/` to the frontend |
| `mongo-pvc.yaml`, `mongo-deployment.yaml`, `mongo-service.yaml` | MongoDB with persistent storage |
| `backend-hpa.yaml` | autoscales the backend 2→6 pods on CPU |

**Rolling updates & rollback** — any change to `backend-deployment.yaml`'s pod spec (e.g. a new `image:` tag) triggers a rolling update automatically:

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl rollout status deployment/backend -n myapp
kubectl rollout undo deployment/backend -n myapp   # revert if something's wrong
```

### Kubernetes (K3s + Traefik)

An alternative to Minikube for a host already running K3s (see
[`k8s/k3s/README.md`](k8s/k3s/README.md) for why K3s needs its own port and
Ingress overlay alongside the Minikube manifests above — nothing in `k8s/*.yaml`
is changed by it). `scripts/` wraps that workflow in three read-only-by-default
Bash scripts, all using `sudo k3s kubectl` and none of them hard-coding a pod
name:

| Script | Purpose |
|---|---|
| [`scripts/verify-k8s.sh`](scripts/verify-k8s.sh) | Read-only health check: node status, `myapp` namespace, backend/frontend/Mongo Deployments+Services+endpoints, the backend HPA, the Traefik controller in `kube-system`, and the `k8s/k3s/ingress-traefik.yaml` Ingress. Prints a ✓/✗ line per check and exits non-zero if anything fails. |
| [`scripts/deploy-k8s.sh`](scripts/deploy-k8s.sh) | Applies the existing manifests in dependency order — namespace → config/secret → Mongo (PVC+Deployment+Service) → backend (Deployment+Service+HPA) → frontend (Deployment+Service) → the existing Traefik Ingress (`k8s/k3s/ingress-traefik.yaml`) — waiting for each Deployment's rollout to finish before moving on. Never applies `k8s/ingress.yaml` (the Minikube/nginx-class Ingress, inert under Traefik) and never touches `k8s/k3s/traefik-port.yaml` (one-time host-level Traefik port setup, see the K3s README). |
| [`scripts/cleanup-k8s.sh`](scripts/cleanup-k8s.sh) | Removes only the application resources the deploy script creates (Ingress, Deployments, Services, HPA, config/secret) from `myapp`. **Preserves `mongo-pvc` (the MongoDB data) and the `myapp` namespace by default.** Pass `--delete-data` to also delete the PVC — this prompts for a typed confirmation (`delete mongo-pvc`) before doing so. Never touches K3s itself, the Traefik controller, Docker/Compose state, or any other namespace. |

```bash
# Assumes K3s is already installed and k8s/k3s/traefik-port.yaml has already
# been applied once per k8s/k3s/README.md (moves Traefik off host :80 so
# Docker Compose can keep it).

./scripts/deploy-k8s.sh      # apply everything, wait for rollouts
./scripts/verify-k8s.sh      # confirm cluster/app/Ingress health

# ...later, to tear the app down again:
./scripts/cleanup-k8s.sh                 # keeps MongoDB data (mongo-pvc)
./scripts/cleanup-k8s.sh --delete-data   # also wipes MongoDB data, after confirmation
```

---

## AWS ECS on Fargate

Production target, and already running — region `ap-south-1`, cluster
`trekeasy-cluster`, service `trekeasy-service`, three ECR repositories
(`trekeasy-backend`, `trekeasy-frontend`, `trekeasy-nginx`), `launchType:
FARGATE`. The database is Amazon DocumentDB (not a self-hosted Mongo
container) — the backend connects to it over TLS using the CA bundle fetched
in [`backend/Dockerfile`](backend/Dockerfile). JWT keys and the DocumentDB
connection string live in Secrets Manager and are injected into the task
definition; nothing AWS-specific is stored in this repo.

This repo does **not** provision that infrastructure — the cluster, service,
ECR repos, DocumentDB cluster and IAM roles already exist and are managed
outside it. `aws/scripts/` only ships new versions onto them:

```bash
export AWS_REGION=ap-south-1
TAG=$(git rev-parse --short HEAD)

./aws/scripts/build-and-push.sh "$TAG"   # 3 images -> ECR AND Docker Hub (mirror), tagged with the git SHA
./aws/scripts/deploy.sh "$TAG"           # new task-def revision + rolling update, waits for stable
```

The reverse-proxy image built for AWS comes from
[`deploy/nginx-ecs/`](deploy/nginx-ecs), not [`deploy/nginx/`](deploy/nginx) —
the two talk to the backend/frontend containers differently (Docker Compose
service names vs. `127.0.0.1`, since a Fargate task shares one network
namespace) and are not interchangeable.

Full documentation: [`docs/TREKEASY_DEVOPS_DOCUMENTATION.md`](docs/TREKEASY_DEVOPS_DOCUMENTATION.md)
(architecture, Docker, Nginx, Kubernetes, Jenkins, GitHub Actions, AWS, security,
troubleshooting) and [`docs/TREKEASY_INTERVIEW_PREPARATION.md`](docs/TREKEASY_INTERVIEW_PREPARATION.md).
Older, still-accurate deep dives: [`docs/DEVOPS_OVERVIEW.md`](docs/DEVOPS_OVERVIEW.md) and [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

---

## CI/CD Pipeline

TrekEasy ships to production through **two separate tools with two separate
jobs**: Jenkins does Continuous Integration (CI), and GitHub Actions does
Continuous Deployment (CD). Jenkins is the gate — GitHub Actions only ever
runs a deployment that Jenkins has already approved.

```text
Developer
   ↓
GitHub
   ↓
Jenkins CI
   ↓
SUCCESS
   ↓
GitHub Actions CD
   ↓
Docker Hub + ECR
   ↓
ECS Fargate
   ↓
Slack
```

**If Jenkins CI fails, deployment does not start.**

### Technology stack (CI/CD & deployment)

| Tool | Role |
|---|---|
| **Jenkins** | Continuous Integration — installs, builds, type-checks, and tests both services on every push to `main` |
| **GitHub Actions** | Continuous Deployment — builds and ships Docker images, updates ECS, notifies Slack |
| **Docker Hub** | Secondary / mirror image registry |
| **AWS ECR** | Production image registry — what ECS Fargate actually pulls from |
| **AWS ECS Fargate** | Production runtime |
| **Slack** | Deployment notifications |

### Jenkins CI (`Jenkinsfile`)

Runs the existing stages, unchanged: `Checkout` → `Backend` (`npm ci`, build,
typecheck, test) → `Frontend` (`npm ci`, build, typecheck) → `Archive`. A Node
20 tool named `node20` is expected to be configured in Jenkins.

Only after all of those succeed does a final stage, **`Trigger GitHub Actions
CD`**, run:

1. It reads the exact commit Jenkins just tested: `SHA=$(git rev-parse HEAD)`.
2. Using a Jenkins **Secret Text** credential named `github-actions-token`
   (a GitHub PAT — never printed to the console), it calls the GitHub REST
   API to dispatch `.github/workflows/cd.yml`, passing that SHA as the
   `commit_sha` input.

Because this is a normal pipeline stage (not a `post` block), it only runs if
every earlier stage succeeded — a failing CI stage stops the pipeline before
this one is ever reached, so GitHub Actions CD is never triggered.

### GitHub Actions CD (`.github/workflows/cd.yml`)

- **Not** triggered by pushes. Its only trigger is the `workflow_dispatch`
  call Jenkins makes, carrying the Jenkins-tested commit as the `commit_sha`
  input.
- Checks out that **exact commit** (`ref: ${{ inputs.commit_sha }}`) — the
  commit Jenkins approved, not whatever happens to be newest on `main` by the
  time the job runs.
- Tags every image with that same commit SHA (`IMAGE_TAG=${{
  inputs.commit_sha }}`), so the version tested, the version built, and the
  version deployed are always identical.
- Does **not** re-run Jenkins's lint/typecheck/test steps — GitHub Actions
  here is deployment only.
- Builds each of the three images **once** and pushes it to both registries,
  rolls the ECS service, then notifies Slack
  (`aws/scripts/build-and-push.sh` + `aws/scripts/deploy.sh`, both unchanged).

Required repo config (**Settings → Secrets and variables → Actions**):
secrets `AWS_DEPLOY_ROLE_ARN` (an IAM role trusted via GitHub OIDC — see
`docs/RUNBOOK.md` §4.2), `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, and variable
`AWS_REGION` = `ap-south-1`. `SLACK_WEBHOOK_URL` is an optional secret. No AWS
keys are stored.

### Docker Hub and AWS ECR

Both registries get the **same image bytes** — each image is built once,
then tagged and pushed twice, so nothing can drift between the mirror and
production:

- **Docker Hub** — secondary/mirror registry.
- **AWS ECR** — the production registry; this is what ECS Fargate pulls from.

### AWS ECS Fargate

Production runtime — cluster `trekeasy-cluster`, service `trekeasy-service`,
region `ap-south-1` (see [AWS ECS on Fargate](#aws-ecs-on-fargate) below for
full details). `aws/scripts/deploy.sh` points the existing service at a new
task-definition revision using the new image tag and waits for the rollout to
finish. It does not create or modify the cluster, service, or IAM roles —
those already exist and are managed outside this repo.

### Slack notifications

Once CD finishes (success or failure), a message is posted to **#trekeasy**
via the `SLACK_WEBHOOK_URL` secret. If that secret isn't set, the notification
step is skipped (not failed).

### `.github/workflows/ci.yml`

A separate, existing workflow — runs on every push and PR into `main`: lint,
typecheck, test, build, for both services across Node 18 and 20, with build
artifacts uploaded. It does not deploy anything and is unrelated to the
Jenkins → GitHub Actions CD flow described above.

### Full deployment flow

1. A developer pushes to `main` on GitHub.
2. Jenkins CI runs: `Checkout` → `Backend` → `Frontend` → `Archive`.
3. If CI succeeds, Jenkins triggers the GitHub Actions `CD` workflow with the
   tested commit SHA.
4. GitHub Actions checks out that exact commit and builds the three Docker
   images.
5. The same images are pushed to Docker Hub and AWS ECR.
6. GitHub Actions updates the ECS Fargate service to the new images.
7. GitHub Actions posts the result to Slack.

**If Jenkins CI fails, deployment does not start.**

---

## Project structure

```
frontend/            Expo app — screens/, components/, lib/, context/
backend/              NestJS API — src/modules/{auth,users,destinations,chat,...}
backend-database/     Mongoose schemas + config, imported by backend/ via @db/*
deploy/nginx/         Reverse-proxy image + config for Docker Compose
deploy/nginx-ecs/     Reverse-proxy image + config for AWS ECS/Fargate (different upstream addressing)
deploy/apache/        Optional Apache alternative to nginx
k8s/                  Kubernetes manifests (Minikube), plus k8s/k3s/ (additive K3s/Traefik overlay)
scripts/              verify-k8s.sh / deploy-k8s.sh / cleanup-k8s.sh — the K3s + Traefik workflow
aws/                  Scripts that deploy to the existing ECS Fargate service (no infra provisioning)
docs/                 TREKEASY_DEVOPS_DOCUMENTATION.md, TREKEASY_INTERVIEW_PREPARATION.md, TREKEASY_ARCHITECTURE_AUDIT.md, DEVOPS_OVERVIEW.md, RUNBOOK.md
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




webhook-final-test-1788425140
poll test 1788425399
