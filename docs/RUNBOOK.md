# TrekEasy — DevOps Runbook ("What you should do")

Every exact command to set up, build, test, run, and deploy TrekEasy from
scratch — locally, on Kubernetes, and on **AWS ECS Fargate** — plus the
manual, click-in-the-console steps that **cannot** be scripted.

Commands are **Linux / macOS / WSL / Git-Bash** (`bash`). On native Windows
PowerShell, swap `export X=y` for `$env:X="y"` and `$(cmd)` for `$(cmd)` (same)
— or just use WSL.

Legend: 🖱️ = manual action in a browser / console · ⌨️ = terminal command.

---

## 0. Install the tools (one time, per workstation)

⌨️
```bash
# Node.js 20 (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20 && nvm use 20
node -v            # v20.x
npm -v

# Docker Engine + Compose plugin  (Docker Desktop on Mac/Windows)
docker --version
docker compose version

# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && sudo ./aws/install
aws --version      # aws-cli/2.x

# jq (used by aws/scripts/deploy.sh)
sudo apt-get install -y jq        # or: brew install jq

# Only for the Kubernetes path:
curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install kubectl /usr/local/bin/kubectl
curl -LO https://github.com/kubernetes/minikube/releases/latest/download/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

---

## 1. Get the code and generate secrets

⌨️
```bash
git clone <this-repo-url> TREKEASY-FINAL
cd TREKEASY-FINAL

# Two 64-hex-character JWT signing keys. Keep them somewhere safe.
openssl rand -hex 32     # -> JWT_SECRET
openssl rand -hex 32     # -> JWT_REFRESH_SECRET
```

---

## 2. Run it locally — no Docker (fastest inner loop)

You need a MongoDB somewhere. Quickest is a throwaway container:

⌨️
```bash
docker run -d --name trekeasy-database -p 27017:27017 mongo:7-jammy
```

### Backend
⌨️
```bash
cd backend
cp .env.example .env
#   edit .env:
#     MONGODB_URI=mongodb://localhost:27017/trekeasy
#     JWT_SECRET=<first key from step 1>
#     JWT_REFRESH_SECRET=<second key>
#     NODE_ENV=development
npm ci
npm run typecheck        # must pass
npm test                 # 88 tests, must pass
npm run start:dev        # -> http://localhost:3001/api
```

Verify:
⌨️
```bash
curl -s http://localhost:3001/api/health        # {"status":"ok",...}
```

### Frontend (second terminal)
⌨️
```bash
cd frontend
npm ci
npm run typecheck
npm run dev              # Expo dev server; press w for web, or scan the QR in Expo Go
```

### Useful backend scripts
⌨️
```bash
cd backend
npm run seed:destinations     # load the trek catalogue into Mongo
npm run lint
```

---

## 3. Run the whole stack locally — Docker Compose

⌨️
```bash
cd TREKEASY-FINAL
cp .env.example .env
#   edit .env: set JWT_SECRET and JWT_REFRESH_SECRET (from step 1).
#   Leave NODE_ENV=production as-is. Add the machine's LAN/VM address to
#   CORS_ORIGINS if you will open the app by IP rather than on localhost.

docker compose up --build            # builds all four: -database / -backend / -frontend / -nginx
```

Open **http://localhost**.

`curl http://localhost/healthz` should print `trekeasy-nginx ok`. If it does not,
the request is not reaching the proxy container at all — something else holds
port 80 — and no change to `deploy/nginx/nginx.conf` will affect what you see.

⌨️ Day-to-day:
```bash
docker compose ps                    # status + health of the 4 containers
docker compose logs -f backend       # tail one service
docker compose down                  # stop
docker compose down -v               # stop AND wipe the Mongo volume
docker compose up -d --build backend # rebuild+restart just one service
```

Images produced (named consistently): `trekeasy-frontend:latest`,
`trekeasy-backend:latest`, `trekeasy-database:latest`.

---

## 4. AWS setup — what already exists, and the one manual step left

The AWS side is **already provisioned and running**: `trekeasy-cluster`,
`trekeasy-service`, the three ECR repos, the DocumentDB cluster, the task
execution/task IAM roles, and the Secrets Manager secrets holding the JWT
keys and the DocumentDB connection string. None of that is created or
changed by anything in this repo — it was set up by hand in the Console and
stays that way. `aws/scripts/` only ships new *application versions* onto it
(§5, §6).

The one thing this repo's CD workflow still needs from a human is a way to
authenticate to AWS from GitHub Actions.

### 4.1 Prerequisites for running the scripts yourself

⌨️ Whoever runs `aws/scripts/*.sh` by hand needs the AWS CLI configured with
credentials that can push to the three ECR repos and
describe/update-service/register-task-definition/wait on
`trekeasy-cluster` / `trekeasy-service`:
```bash
aws configure
aws sts get-caller-identity      # confirms you're authenticated
export AWS_REGION=ap-south-1
```

### 4.2 🖱️ GitHub → AWS trust, for the CD workflow (skip if deploying only from your laptop)

The CD workflow authenticates to AWS with **OIDC** — no stored AWS keys.

1. 🖱️ **IAM → Identity providers → Add provider**
   - Type: **OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
2. 🖱️ **IAM → Roles → Create role → Web identity**
   - Identity provider: the one just added
   - Audience: `sts.amazonaws.com`
   - Add a trust-policy condition so only *this* repo can assume it:
     ```json
     "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:*" }
     ```
   - Permissions: push/pull on the three ECR repos
     (**AmazonEC2ContainerRegistryPowerUser**, or a repo-scoped policy) plus
     `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`,
     `ecs:RegisterTaskDefinition`, `ecs:UpdateService` and
     `iam:PassRole` on the task's execution/task roles, scoped to
     `trekeasy-cluster` / `trekeasy-service`. Name it `trekeasy-github-deploy`.
     Copy its ARN.
3. 🖱️ **GitHub repo → Settings → Secrets and variables → Actions**
   - **New repository secret**: `AWS_DEPLOY_ROLE_ARN` = the role ARN
   - **New repository secret**: `SLACK_WEBHOOK_URL` = your Slack incoming webhook (optional)
   - **New repository variable**: `AWS_REGION` = `ap-south-1`

### 4.3 Changing a backend secret

JWT keys and the DocumentDB connection string live in **Secrets Manager**
and are referenced by ARN from the task definition (`secrets`, not
`environment`). Rotate a value in Secrets Manager, then force the service to
pick it up:
```bash
aws secretsmanager put-secret-value --region ap-south-1 \
  --secret-id <secret-id> --secret-string '...'
aws ecs update-service --region ap-south-1 --cluster trekeasy-cluster \
  --service trekeasy-service --force-new-deployment
```

### 4.4 Environment-variable ownership (who sets what, where)

| Variable | Where it lives in AWS | Set by |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, DocumentDB connection string | Secrets Manager, referenced from the task definition | set by hand in Secrets Manager (§4.3) |
| `CORS_ORIGINS`, `NODE_ENV`, `PORT`, `TRUST_PROXY` | backend container's `environment` in the task definition | set by hand on the task definition (console, or a new revision) |
| `EXPO_PUBLIC_API_URL` | **baked into the frontend image** at build (`/api`) | `build-and-push.sh --build-arg` |
| `CLOUDINARY_*` | optional — unset falls back to local disk on the backend | add to the task definition if you adopt Cloudinary |
| `AWS_DEPLOY_ROLE_ARN`, `SLACK_WEBHOOK_URL`, `AWS_REGION` | GitHub Actions secrets/variables | you, in the GitHub UI (§4.2) |

---

## 5. Ship a new version to AWS ECS Fargate

The cluster, service, ECR repos, DocumentDB and IAM roles already exist (§4).
This is the only AWS deployment flow this repo has — it's exactly what
`.github/workflows/cd.yml` runs on every push to `main`.

Prereqs: §0 (tools), §4.1 done, shell has `AWS_REGION=ap-south-1` exported
and `aws sts get-caller-identity` succeeds.

### 5.1 Build and push the three images to ECR
⌨️
```bash
cd TREKEASY-FINAL
TAG=$(git rev-parse --short HEAD)

./aws/scripts/build-and-push.sh "$TAG"
#   -> <acct>.dkr.ecr.ap-south-1.amazonaws.com/trekeasy-backend  : <tag> + latest
#   -> ...                                     /trekeasy-frontend : <tag> + latest
#   -> ...                                     /trekeasy-nginx    : <tag> + latest
```

### 5.2 Roll the service onto the new tag
⌨️
```bash
./aws/scripts/deploy.sh "$TAG"
#   reads the task def currently on trekeasy-service, swaps in the new image
#   tags, registers a new revision, updates the service, and waits for
#   `aws ecs wait services-stable`
```

### 5.3 Get the URL and smoke-test

⌨️ Find the ALB's DNS name once (it doesn't change day to day):
```bash
aws elbv2 describe-load-balancers --region ap-south-1 \
  --query 'LoadBalancers[].DNSName' --output text
```
```bash
APP_URL=http://<alb-dns-name>
curl -s "$APP_URL/api/health"          # {"status":"ok",...}
curl -sI "$APP_URL/"                   # 200, text/html  (the Expo bundle)
```

### 5.4 Trek catalogue

Nothing to do — the backend seeds the destination catalogue on every boot
(`DestinationsService.onModuleInit`, an idempotent upsert). Confirm once the
backend is healthy:

⌨️
```bash
curl -s "$APP_URL/api/destinations" | head -c 300
```

To force a refresh after editing `backend/src/data/trek-metadata.ts`, redeploy
the backend (§5.1–5.2) — the new task re-runs the upsert.

---

## 6. Day-2 operations

### Ship a new version (what CD does automatically on push to `main`)

See §5 — `build-and-push.sh "$TAG"` then `deploy.sh "$TAG"`.

### Roll back
⌨️
```bash
aws ecs describe-services --region ap-south-1 --cluster trekeasy-cluster \
  --services trekeasy-service --query 'services[0].taskDefinition'      # current revision

aws ecs update-service --region ap-south-1 --cluster trekeasy-cluster \
  --service trekeasy-service --task-definition <family>:<PREVIOUS_REVISION>

aws ecs wait services-stable --region ap-south-1 --cluster trekeasy-cluster \
  --services trekeasy-service
```

### Logs

Find the log group(s) configured on the task definition, then tail them:
⌨️
```bash
TASK_DEF=$(aws ecs describe-services --region ap-south-1 --cluster trekeasy-cluster \
  --services trekeasy-service --query 'services[0].taskDefinition' --output text)

aws ecs describe-task-definition --region ap-south-1 --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[].logConfiguration.options'

aws logs tail <log-group> --region ap-south-1 --follow
```

### Scale
⌨️
```bash
aws ecs update-service --region ap-south-1 --cluster trekeasy-cluster \
  --service trekeasy-service --desired-count 2
```

### Change a backend env var / secret

- Non-secret (`CORS_ORIGINS`, `NODE_ENV`, …): edit the container's
  `environment` on the task definition (console, or `describe-task-definition`
  → edit the JSON → `register-task-definition` → `update-service`, the same
  mechanic `aws/scripts/deploy.sh` uses for image tags).
- Secret (JWT keys, DocumentDB URI): see §4.3.

### Open a shell in a running task (debugging)
⌨️
```bash
aws ecs update-service --region ap-south-1 --cluster trekeasy-cluster \
  --service trekeasy-service --enable-execute-command --force-new-deployment
# then:
TASK=$(aws ecs list-tasks --region ap-south-1 --cluster trekeasy-cluster \
  --service-name trekeasy-service --query 'taskArns[0]' --output text)
aws ecs execute-command --region ap-south-1 --cluster trekeasy-cluster \
  --task "$TASK" --container trekeasy-backend --interactive --command "/bin/sh"
```

### Scaling down / tearing down

This repo's scripts never delete or resize AWS infrastructure — scaling the
service to 0, deleting the service/cluster, or decommissioning ECR
repos/DocumentDB/secrets are account-owner actions taken by hand in the
Console or CLI, outside this repo's scope.

---

## 7. Kubernetes (Minikube) — alternative to ECS

⌨️
```bash
minikube start
eval $(minikube docker-env)      # build images straight into Minikube's Docker

docker build -f backend/Dockerfile          -t trekeasy-backend:latest  .
docker build -f frontend/Dockerfile --build-arg EXPO_PUBLIC_API_URL=/api \
                                            -t trekeasy-frontend:latest frontend
docker build -f backend-database/Dockerfile -t trekeasy-database:latest backend-database

minikube addons enable ingress
minikube addons enable metrics-server

# db-secret.yaml ships with demo JWT keys — replace them first:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
kubectl apply -f k8s/

kubectl get pods -n myapp -w
echo "$(minikube ip) app.local" | sudo tee -a /etc/hosts
curl http://app.local/api/health
```

Rolling update / rollback:
⌨️
```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl rollout status deployment/backend -n myapp
kubectl rollout undo   deployment/backend -n myapp
```

---

## 8. Full "from zero" checklist

- [ ] §0 tools installed (`node -v`, `docker --version`, `aws --version`, `jq --version`)
- [ ] §1 repo cloned, two `openssl rand -hex 32` keys saved
- [ ] Local: `backend` `npm ci && npm test` green; `npm run start:dev`; `/api/health` = ok
- [ ] Local: `frontend` `npm ci && npm run typecheck`; `npm run dev` loads
- [ ] Compose: `.env` filled; `docker compose up --build`; http://localhost works
- [ ] ⌨️ §4.1 `aws configure`, `aws sts get-caller-identity`, `AWS_REGION=ap-south-1` exported
- [ ] 🖱️ §4.2 GitHub OIDC provider + `trekeasy-github-deploy` role + repo secrets/vars (if using CD)
- [ ] ⌨️ §5.1 `./aws/scripts/build-and-push.sh "$TAG"`
- [ ] ⌨️ §5.2 `./aws/scripts/deploy.sh "$TAG"` (registers a new revision, waits for `services-stable`)
- [ ] ⌨️ §5.3 `curl $APP_URL/api/health` = ok
- [ ] ⌨️ §5.4 trek catalogue present (`curl $APP_URL/api/destinations`)
- [ ] Push to `main` → CD builds, pushes, rolls `trekeasy-service`, posts to Slack (if configured)

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `deploy.sh` fails to find the service | wrong cluster/service name or region | confirm `ECS_CLUSTER=trekeasy-cluster`, `ECS_SERVICE=trekeasy-service`, `AWS_REGION=ap-south-1` |
| Service won't start, `CannotPullContainerError` | image tag not in ECR | run `build-and-push.sh` with that tag first |
| Backend task cycles, logs show `ECONNREFUSED`/`MongoServerSelectionError` | DocumentDB connection string or TLS CA bundle issue | check the backend's CloudWatch logs; confirm `global-bundle.pem` was fetched at build time (`backend/Dockerfile`) and the Secrets Manager connection string is current |
| Backend logs: `CORS_ORIGINS is not set; refusing all cross-origin` | `CORS_ORIGINS` empty on the task definition | set it on the backend container's `environment` (console, or a new task-def revision) to the ALB's public origin |
| ALB returns 503 | no healthy targets | `aws elbv2 describe-target-health --target-group-arn <arn>`; check the container health check + security groups |
| Chat/socket disconnects every ~60 s | ALB idle timeout too low, or no stickiness for the `/socket.io/*` rule | check the ALB's idle timeout and the target group's stickiness/`/socket.io/*` rule in the console |
| `expo export` OOMs in CI | Node heap | already handled by `node:20-alpine`; if it recurs, raise the frontend build's runner size |
| CD fails at "Configure AWS credentials" | OIDC trust / role ARN | re-check §4.2 trust policy `sub` matches `repo:<ORG>/<REPO>:*` and `AWS_DEPLOY_ROLE_ARN` secret |
| CD fails inside `deploy.sh` with a `jq`/IAM error | the deploy role is missing an ECS or `iam:PassRole` permission | see the permission list in §4.2 |
