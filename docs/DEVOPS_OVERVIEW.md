# TrekEasy — Project & DevOps Overview

A plain-English tour of how TrekEasy is built, containerized, tested, and
deployed. No prior DevOps knowledge assumed. If you just want the commands,
skip to [`RUNBOOK.md`](RUNBOOK.md).

---

## 1. What the application is

TrekEasy is a trek-discovery app for the Himalayas: personalized
recommendations, trending treks, and a group chat per expedition. It is a
**3-tier application**:

```
        ┌─────────────────────────────────────────────┐
        │  TIER 1 — Frontend                           │
        │  Expo / React Native app (phone + web).      │
        │  The web build is plain static files         │
        │  (HTML/JS/CSS) served by a tiny web server.   │
        └───────────────────────┬─────────────────────┘
                                │ HTTPS / WebSocket
        ┌───────────────────────▼─────────────────────┐
        │  TIER 2 — Backend                           │
        │  NestJS (Node.js). REST API under /api plus  │
        │  a real-time chat socket. Contains all the   │
        │  business logic.                            │
        └───────────────────────┬─────────────────────┘
                                │ MongoDB wire protocol
        ┌───────────────────────▼─────────────────────┐
        │  TIER 3 — Database                          │
        │  MongoDB. Stores users, treks, chat         │
        │  messages, likes.                          │
        └─────────────────────────────────────────────┘
```

"3-tier" simply means the **presentation** (frontend), the **logic**
(backend), and the **data** (database) are three separate programs that can be
scaled, deployed, and reasoned about independently.

### Repository layout

| Folder | Tier | What it holds |
|---|---|---|
| [`frontend/`](../frontend) | 1 | Expo app — `app/` (screens), `components/`, `lib/` (API client), `context/` |
| [`backend/`](../backend) | 2 | NestJS API — `src/modules/{auth,users,destinations,chat,recommendations,itinerary,health}` |
| [`backend-database/`](../backend-database) | 2↔3 | Mongoose **schemas** + DB/JWT config. Not a running server — it compiles *into* the backend image. MongoDB is the actual tier-3 service. |
| [`deploy/`](../deploy) | — | `nginx/` reverse-proxy config, `apache/` alternative |
| [`k8s/`](../k8s) | — | Kubernetes manifests (Minikube) |
| [`aws/`](../aws) | — | **ECS on Fargate** — scripts that ship new versions onto the already-running cluster/service |
| [`.github/workflows/`](../.github/workflows) | — | GitHub Actions CI and CD |
| [`Jenkinsfile`](../Jenkinsfile) | — | Equivalent pipeline for a Jenkins server |
| [`docker-compose.yml`](../docker-compose.yml) | — | Run all four containers locally with one command |

### How the frontend finds the backend

The frontend is compiled with `EXPO_PUBLIC_API_URL=/api` **baked in** — a
*relative* path. When the browser loads the app from `http://some-host/`, it
resolves API calls against **that same host** (`http://some-host/api/...`).
That is why every deployment (nginx, Kubernetes Ingress, AWS ALB) puts the
frontend and backend behind **one hostname** and routes by path. Same origin =
no CORS headaches, and the same image works in every environment.

### Standardized names

One naming scheme for frontend/backend everywhere — Compose, Kubernetes, and
AWS:

| Tier | Image | Container / task | Network name |
|---|---|---|---|
| frontend | `trekeasy-frontend` | `trekeasy-frontend` | `frontend` |
| backend | `trekeasy-backend` | `trekeasy-backend` | `backend` |
| database (Compose / K8s only) | `trekeasy-database` | `trekeasy-database` | `mongo` |

The database's *network name* stays `mongo` on purpose in Compose and
Kubernetes — it is hard-coded into the connection string
`mongodb://mongo:27017/trekeasy` in both places (Compose, `k8s/db-secret.yaml`).
Renaming a load-bearing hostname buys nothing; the **image** and **container**
names carry the brand. AWS has no `trekeasy-database` container at all — the
database tier there is the managed **Amazon DocumentDB** service (see §5b).

---

## 2. Docker & Dockerfiles

### What a container is

A **container** is your app plus exactly the runtime and libraries it needs,
packaged into a single read-only bundle called an **image**. The same image
runs identically on your laptop, in CI, and on AWS — "works on my machine"
stops being a problem. A **Dockerfile** is the recipe for building an image.

### The four images

| Dockerfile | Base image | Build strategy |
|---|---|---|
| [`backend/Dockerfile`](../backend/Dockerfile) | `node:20-alpine` | **multi-stage**: stage 1 installs *all* deps and compiles TypeScript → JS; stage 2 keeps only production deps + the compiled `dist/`. Smaller, fewer CVEs. |
| [`frontend/Dockerfile`](../frontend/Dockerfile) | `node:20-alpine` → `nginx:alpine` | stage 1 runs `expo export` to produce static web files and fails the build if no bundle came out; stage 2 is nginx serving that folder on port 8080 with the rules in [`frontend/nginx.conf`](../frontend/nginx.conf) — real 404s for missing hashed assets, SPA fallback only for routes. |
| [`backend-database/Dockerfile`](../backend-database/Dockerfile) | `mongo:7-jammy` | official MongoDB + our `init-indexes.js` bootstrap script. |
| [`deploy/nginx/Dockerfile`](../deploy/nginx/Dockerfile) (compose only) | `nginx:alpine` | the reverse proxy, with `nginx.conf` **copied into the image**. Not bind-mounted: a single-file mount tracks the file's inode, so a `git pull` or an editor save silently leaves the container on the old config until it is recreated. |

### Key ideas used here

- **Multi-stage builds** — the compiler and dev dependencies never reach the
  final image.
- **Build context is the repo root for the backend** — because
  `backend/tsconfig.json` compiles `backend/` and `backend-database/` together.
  That is why the compose file and every build command say
  `docker build -f backend/Dockerfile .` (the `.` is the repo root).
- **Build-time vs run-time config.** `EXPO_PUBLIC_API_URL` is a **build arg**
  (`--build-arg`) because Expo inlines it into the JS bundle when it exports.
  Everything the *backend* needs (`MONGODB_URI`, `JWT_SECRET`, …) is a
  **runtime env var**, injected when the container starts.
- **`HEALTHCHECK`** — every image knows how to answer "are you actually
  working?" (`GET /api/health` for the backend, `GET /` for the frontend,
  `db.adminCommand('ping')` for Mongo). Compose, Kubernetes, and ECS all use
  these to decide when a container is ready for traffic.
- **`.dockerignore`** — keeps `node_modules`, `.env`, and build output out of
  the build context so images are small and never bake in a secret.

---

## 3. NGINX — the reverse proxy

### What "reverse proxy" means

A normal proxy sits in front of *clients*. A **reverse proxy** sits in front of
*servers*: the outside world talks only to nginx, and nginx decides which
internal service should handle each request. Benefits:

- **One public entry point** (one hostname, one port, one TLS certificate).
- **Path-based routing** — `/api` → backend, everything else → frontend.
- **The browser sees a single origin**, so no cross-origin (CORS) problems and
  cookies "just work".
- A natural place to add caching, rate limiting, gzip, and access logs later.

### TrekEasy's routing ([`deploy/nginx/nginx.conf`](../deploy/nginx/nginx.conf))

| Request path | Sent to | Why it is separate |
|---|---|---|
| `/api/…` | `backend:3001` | the REST API |
| `/socket.io/…` | `backend:3001` | real-time chat; needs the WebSocket `Upgrade` headers and a long read timeout |
| `/uploads/…` | `backend:3001` | locally-stored images, served *outside* the `/api` prefix |
| `/` (everything else) | `frontend:8080` | the Expo web bundle |

**The exact same four rules appear in `k8s/ingress.yaml` and in the AWS ALB's
listener rules.** nginx, the Kubernetes Ingress, and the ALB are three
implementations of one idea: *single front door, route by path*.

---

## 4. CI/CD — automated build, test, and deploy

**CI (Continuous Integration)** = every push is automatically built and tested,
so breakage is caught in minutes, not in code review.
**CD (Continuous Delivery/Deployment)** = a change that passes CI is
automatically packaged and shipped to a running environment.

TrekEasy has **three** pipeline definitions doing the same job for different
tools. You only need one; all three are kept working as reference.

### 4a. GitHub Actions — CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml))

Runs on **every push and every pull request**. Two parallel jobs
(`backend`, `frontend`), each on Node 18 **and** 20:

```
checkout → npm ci → lint → typecheck → test → build → upload build artifact
```

If any step fails, the commit is marked ❌ and (for a PR) merging is blocked.

### 4b. GitHub Actions — CD ([`.github/workflows/cd.yml`](../.github/workflows/cd.yml))

Runs on **push to `main`** (or manually, choosing `staging`/`production`):

```
test  ─┐
       ├─ deploy:
       │    1. assume an AWS IAM role via OIDC (no long-lived keys)
       │    2. aws/scripts/build-and-push.sh  → logs in to ECR, builds the 3
       │                                        images, pushes each tagged
       │                                        with the git SHA
       │    3. aws/scripts/deploy.sh          → reads the task definition
       │                                        currently on trekeasy-service,
       │                                        swaps in the new image tags,
       │                                        registers a new revision,
       │                                        updates the service, waits
       │                                        for it to stabilize
       └─   4. post the result to Slack (#trekeasy), if configured
```

This ships a new version onto the cluster/service that already exists — it
does not create or reconfigure any AWS resource. Deployment secrets/vars live
in **GitHub → Settings → Secrets and variables → Actions** — never in the
repo. See `RUNBOOK.md` §4.

### 4c. Jenkins ([`Jenkinsfile`](../Jenkinsfile))

The same stages expressed as a declarative Jenkins pipeline, for teams running
a Jenkins server instead of (or alongside) GitHub Actions:

| Stage | What it does |
|---|---|
| **Checkout** | pull the commit that triggered the build |
| **Build** | `npm ci` + compile backend and frontend |
| **Test** | `npm run typecheck` + `npm test` (backend), `typecheck` (frontend) |
| **Archive** | save `backend/dist/**` and `frontend/dist/**` as downloadable build artifacts |
| *post* | print success/failure, always `cleanWs()` to free disk |

It expects a **Node 20 tool named `node20`** configured in *Jenkins → Manage
Jenkins → Tools*. A production Jenkins setup would add `Push` and `Deploy`
stages mirroring the GitHub CD job (build image → push to registry → roll the
service).

### The pipeline stages, in general terms

| Stage | Question it answers | TrekEasy tooling |
|---|---|---|
| **Build** | Does it compile? | `npm ci && npm run build`, `docker build` |
| **Test** | Does it behave? | `jest` (88 backend unit tests), `tsc --noEmit`, `eslint` |
| **Push** | Where's the artifact? | `docker push` to **ECR** (`trekeasy-backend` etc.) |
| **Deploy** | How does it reach users? | register a new ECS task-definition revision and `update-service` → **rolling update** behind the ALB health check |

---

## 5. Orchestration manifests — Kubernetes and ECS

Once you have images, something has to **run** them: keep the right number of
copies alive, restart crashed ones, roll out new versions without downtime,
and wire networking. That "something" is an **orchestrator**. TrekEasy ships
configs for two.

### 5a. Kubernetes ([`k8s/`](../k8s)) — for Minikube / any K8s cluster

| File | Kind | Plain English |
|---|---|---|
| `namespace.yaml` | Namespace | a private folder (`myapp`) for all TrekEasy objects |
| `app-config.yaml` | ConfigMap | non-secret backend env vars (`NODE_ENV`, `CORS_ORIGINS`, …) |
| `db-secret.yaml` | Secret | `MONGODB_URI` + JWT keys (base64, *not* encrypted — see the file's note) |
| `mongo-deployment.yaml` + `-service.yaml` + `mongo-pvc.yaml` | Deployment / Service / PersistentVolumeClaim | MongoDB (1 replica) with a 2 GiB disk that survives restarts |
| `backend-deployment.yaml` + `-service.yaml` | Deployment / Service | the API — **2 replicas**, rolling updates, liveness/readiness probes on `/api/health` |
| `backend-hpa.yaml` | HorizontalPodAutoscaler | automatically scale the backend 2 → 6 pods when CPU > 70 % |
| `frontend-deployment.yaml` + `-service.yaml` | Deployment / Service | the Expo web bundle — 2 replicas, ClusterIP (only the Ingress can reach it) |
| `ingress.yaml` | Ingress | the single front door on `app.local`, same path routing as nginx |

Core Kubernetes vocabulary: a **Pod** is one running container group; a
**Deployment** keeps *N* identical Pods alive and does rolling updates; a
**Service** is a stable internal name+IP load-balancing across a Deployment's
Pods; an **Ingress** exposes Services to the outside world by hostname/path.

### 5b. AWS ECS on Fargate ([`aws/`](../aws)) — the target for this project

**ECS** (Elastic Container Service) is AWS's orchestrator. **Fargate** is the
"serverless" mode: you never create or patch EC2 servers — you hand AWS a task
definition and it finds capacity to run it. `launchType: FARGATE` throughout.

The cluster, service, ECR repositories, DocumentDB cluster, IAM roles,
networking and Secrets Manager secrets **already exist** — they were created
and are changed outside this repository (console / by hand), not by anything
under `aws/`. This repo only ships new application versions onto them (see
§4b above and [`aws/README.md`](../aws/README.md)); it does not provision,
resize, or tear down any of it, and there is no CloudFormation here.

ECS vocabulary mapped to Kubernetes:

| ECS | ≈ Kubernetes | TrekEasy |
|---|---|---|
| **Task definition** | Pod spec | image, CPU/memory, ports, env, secrets, health check, log config for the containers running on `trekeasy-service` |
| **Task** | Pod | one running copy of a task definition |
| **Service** | Deployment | `trekeasy-service` — keeps the desired count of tasks alive, does rolling updates, registers them with the load balancer |
| **Cluster** | (the cluster) | `trekeasy-cluster` — just a namespace for the service |
| **ALB + target groups** | Ingress | single front door, path routing |
| **Secrets Manager** | Secret | JWT keys and the DocumentDB connection string, injected into the task definition as container secrets |
| **Task execution role** | — | lets the ECS agent pull images from ECR / read secrets / write logs |
| **Task role** | ServiceAccount (IRSA) | permissions for the app code itself |

The database tier is **Amazon DocumentDB**, a managed service — not a
container TrekEasy runs itself. The backend connects to it over TLS using
Amazon's CA bundle (fetched at image build time in
[`backend/Dockerfile`](../backend/Dockerfile); see the `MONGODB_URI`
`tlsCAFile` parameter), the same driver code path as the local/Compose/K8s
Mongo connection.

`aws/scripts/deploy.sh` never needs to know the task definition's roles,
secrets, subnets, or security groups: it reads whatever is *currently*
registered on `trekeasy-service`, replaces only the image tags for the
`trekeasy-backend` / `trekeasy-frontend` / `trekeasy-nginx` containers, and
registers that as a new revision. Everything else about the task carries
forward unchanged.

---

## 6. One change, five environments

| You run… | It becomes… |
|---|---|
| `npm run start:dev` | local Node process, Mongo on `localhost` |
| `docker compose up` | 4 containers on your laptop, nginx on `:80` |
| push to a branch | GitHub Actions CI: lint + typecheck + test + build |
| `kubectl apply -f k8s/` | 2+2+1 pods on Minikube, Ingress on `app.local` |
| push to `main` | GitHub Actions CD → ECR → ECS Fargate rolling update behind the ALB |

Same source, same Dockerfiles, same health checks, same routing rules — only
the orchestrator changes.
