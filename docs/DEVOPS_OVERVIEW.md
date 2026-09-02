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
| [`aws/`](../aws) | — | **ECS on Fargate** — CloudFormation + task definitions + scripts |
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

One naming scheme everywhere — Compose, Kubernetes, and AWS:

| Tier | Image | Container / task | Network name |
|---|---|---|---|
| frontend | `trekeasy-frontend` | `trekeasy-frontend` | `frontend` |
| backend | `trekeasy-backend` | `trekeasy-backend` | `backend` |
| database | `trekeasy-database` | `trekeasy-database` | `mongo` |

The database's *network name* stays `mongo` on purpose — it is hard-coded into
the connection string `mongodb://mongo:27017/trekeasy` in several places
(Compose, `k8s/db-secret.yaml`, AWS Cloud Map). Renaming a load-bearing
hostname buys nothing; the **image** and **container** names carry the brand.

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
| [`frontend/Dockerfile`](../frontend/Dockerfile) | `node:20-alpine` → `nginx:alpine` | stage 1 runs `expo export` to produce static web files; stage 2 is just nginx serving that folder on port 8080. |
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

**The exact same four rules appear in `k8s/ingress.yaml` and in the AWS ALB
listener rules** (`aws/cloudformation/02-platform.yaml`). nginx, the Kubernetes
Ingress, and the ALB are three implementations of one idea: *single front
door, route by path*.

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
       │    2. docker login to ECR
       │    3. aws/scripts/build-and-push.sh  → 3 images to ECR, tagged with the git SHA
       │    4. aws/scripts/deploy.sh          → new task-def revisions + rolling update
       └─   5. post the result to Slack (#trekeasy)
```

Deployment secrets/vars live in **GitHub → Settings → Secrets and variables →
Actions** — never in the repo. See `RUNBOOK.md` §4.

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

ECS vocabulary mapped to Kubernetes:

| ECS | ≈ Kubernetes | TrekEasy |
|---|---|---|
| **Task definition** | Pod spec | one per tier — image, CPU/memory, ports, env, secrets, health check, log config, volumes |
| **Task** | Pod | one running copy of a task definition |
| **Service** | Deployment | keeps *N* tasks alive, does rolling updates, registers them with the load balancer |
| **Cluster** | (the cluster) | `trekeasy-cluster` — just a namespace for services |
| **Cloud Map** | kube-dns / Service | private DNS: `mongo.trekeasy.local` → the database task's IP |
| **ALB + target groups** | Ingress | single front door, path routing |
| **EFS volume** | PersistentVolumeClaim | durable `/data/db` for Mongo, `/uploads` for the backend |
| **Secrets Manager** | Secret | JWT keys, injected as env vars at task start |
| **Task execution role** | — | lets the ECS agent pull images / read secrets / write logs |
| **Task role** | ServiceAccount (IRSA) | permissions for the app code itself (empty here — TrekEasy calls no AWS APIs) |

The three CloudFormation stacks:

```
01-network.yaml   VPC, 2 Availability Zones, public subnets (ALB + NAT),
                  private subnets (every task runs here, no public IP).

02-platform.yaml  3 ECR repos · 3 CloudWatch log groups · IAM roles ·
                  4 security groups (ALB→app→db→EFS, least privilege) ·
                  internet-facing ALB with the /api,/uploads,/socket.io rules ·
                  encrypted EFS file system + access points ·
                  Cloud Map namespace "trekeasy.local" ·
                  Secrets Manager secret "trekeasy/jwt".

03-services.yaml  ECS cluster · backend/frontend/database task definitions
                  (FARGATE) · the 3 services wired to the ALB target groups
                  and Cloud Map.
```

**Network security posture:** the ALB is the only thing with a public IP.
Backend and frontend tasks accept traffic **only from the ALB's security
group**; the database accepts traffic **only from the backend's security
group**; EFS accepts NFS **only from backend + database**. Outbound internet
(for pulling images, Cloudinary, etc.) goes through the NAT Gateway.

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
