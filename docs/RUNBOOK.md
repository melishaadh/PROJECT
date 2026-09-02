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

## 4. 🖱️ MANUAL AWS SETUP — do this once, by hand

These steps create identities and permissions. They are deliberately **not**
in a script: they need a human with account-owner access and they rarely
change.

### 4.1 AWS account + admin CLI access
1. 🖱️ Create or use an AWS account. Sign in to the **Console**.
2. 🖱️ **IAM → Users → Create user** → name `trekeasy-admin` → attach
   **AdministratorAccess** (for bootstrapping only; tighten later).
3. 🖱️ That user → **Security credentials → Create access key → CLI**.
4. ⌨️ On your workstation:
   ```bash
   aws configure
   #   AWS Access Key ID     : <from step 3>
   #   AWS Secret Access Key : <from step 3>
   #   Default region name   : us-east-1        (pick one, use it everywhere)
   #   Default output format  : json
   aws sts get-caller-identity      # confirms you're authenticated
   ```

### 4.2 Choose your region and export it
⌨️
```bash
export AWS_REGION=us-east-1
export PROJECT_NAME=trekeasy
```

### 4.3 Put the JWT keys where the pipeline expects them

`aws/scripts/provision.sh` reads them from your environment and writes them
into **AWS Secrets Manager** (`trekeasy/jwt`). Nothing else needs them.

⌨️
```bash
export JWT_SECRET=<first key from step 1>
export JWT_REFRESH_SECRET=<second key from step 1>
```

### 4.4 🖱️ GitHub → AWS trust, for the CD workflow (skip if deploying only from your laptop)

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
   - Permissions: start with **AmazonEC2ContainerRegistryPowerUser** +
     **AmazonECS_FullAccess** + `cloudformation:*` on the `trekeasy-*` stacks
     (tighten afterwards). Name it `trekeasy-github-deploy`. Copy its ARN.
3. 🖱️ **GitHub repo → Settings → Secrets and variables → Actions**
   - **New repository secret**: `AWS_DEPLOY_ROLE_ARN` = the role ARN
   - **New repository secret**: `SLACK_WEBHOOK_URL` = your Slack incoming webhook (optional)
   - **New repository variable**: `AWS_REGION` = `us-east-1`

### 4.5 🖱️ (Optional) HTTPS

The templates create an **HTTP :80** listener. For real HTTPS:
1. 🖱️ **Route 53** — register or import a domain.
2. 🖱️ **ACM (Certificate Manager)** in your region — request a public cert for
   e.g. `trekeasy.example.com`, validate via DNS.
3. 🖱️ **EC2 → Load Balancers → trekeasy-alb → Listeners** — add a **:443**
   listener with the cert, same rules as :80; change the :80 listener to
   *redirect to :443*.
4. 🖱️ **Route 53** — `A`/`ALIAS` record `trekeasy.example.com` → the ALB.
5. ⌨️ Update the backend's `CORS_ORIGINS` to `https://trekeasy.example.com`
   (edit `03-services.yaml` or the task definition) and redeploy.

### 4.6 Environment-variable ownership (who sets what, where)

| Variable | Where it lives in AWS | Set by |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Secrets Manager `trekeasy/jwt` | `provision.sh` from your shell env (§4.3) |
| `MONGODB_URI` | backend task definition (`mongodb://mongo.trekeasy.local:27017/trekeasy`) | CloudFormation, automatic |
| `CORS_ORIGINS`, `PUBLIC_BASE_URL` | backend task definition | CloudFormation, derived from the ALB DNS name |
| `NODE_ENV`, `PORT`, `TRUST_PROXY` | backend task definition | CloudFormation, static |
| `EXPO_PUBLIC_API_URL` | **baked into the frontend image** at build (`/api`) | `build-and-push.sh --build-arg` |
| `CLOUDINARY_*` | *not set* → uploads use the EFS `/uploads` volume | add to `03-services.yaml` `Environment` / `Secrets` if you adopt Cloudinary |
| `AWS_DEPLOY_ROLE_ARN`, `SLACK_WEBHOOK_URL`, `AWS_REGION` | GitHub Actions secrets/variables | you, in the GitHub UI (§4.4) |

---

## 5. Deploy to AWS ECS Fargate — from scratch

Prereqs: §0 (tools), §1 (secrets), §4.1–4.3 done, shell has `AWS_REGION`,
`PROJECT_NAME`, `JWT_SECRET`, `JWT_REFRESH_SECRET` exported.

### 5.1 Create the network + platform (VPC, ALB, ECR, EFS, IAM, secrets)
⌨️
```bash
cd TREKEASY-FINAL
chmod +x aws/scripts/*.sh

./aws/scripts/provision.sh          # no tag -> stops after the platform stack
#   deploys:  trekeasy-network   (VPC, subnets, NAT gateway)
#             trekeasy-platform  (ECR repos, ALB, IAM, EFS, Cloud Map, secret)
```

Run with no argument the first time — the ECS **services** stack is created in
§5.3, once the ECR repos have images to pull.

### 5.2 Build and push the three images to ECR
⌨️
```bash
./aws/scripts/build-and-push.sh
#   -> <acct>.dkr.ecr.<region>.amazonaws.com/trekeasy-database : <git-sha> + latest
#   -> ...                                    /trekeasy-backend  : <git-sha> + latest
#   -> ...                                    /trekeasy-frontend : <git-sha> + latest
```

### 5.3 Create the ECS services, pinned to a real image tag
⌨️
```bash
TAG=$(git rev-parse --short HEAD)
./aws/scripts/provision.sh "$TAG"        # now deploys trekeasy-services, pinned :$TAG

# Wait until all three services are stable:
aws ecs wait services-stable --region "$AWS_REGION" --cluster trekeasy-cluster \
  --services trekeasy-database trekeasy-backend trekeasy-frontend
```

### 5.4 Get the URL and smoke-test
⌨️
```bash
APP_URL=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name trekeasy-platform \
  --query 'Stacks[0].Outputs[?OutputKey==`AppUrl`].OutputValue' --output text)
echo "$APP_URL"

curl -s "$APP_URL/api/health"          # {"status":"ok",...}
curl -sI "$APP_URL/"                   # 200, text/html  (the Expo bundle)
```

### 5.5 Trek catalogue

Nothing to do — the backend seeds the destination catalogue on every boot
(`DestinationsService.onModuleInit`, an idempotent upsert). Confirm once the
backend is healthy:

⌨️
```bash
curl -s "$APP_URL/api/destinations" | head -c 300
```

To force a refresh after editing `backend/src/data/trek-metadata.ts`, redeploy
the backend (§6) — the new task re-runs the upsert.

---

## 6. Day-2 operations

### Ship a new version (what CD does automatically on push to `main`)
⌨️
```bash
TAG=$(git rev-parse --short HEAD)
./aws/scripts/build-and-push.sh "$TAG"
./aws/scripts/deploy.sh "$TAG"        # new task-def revisions + rolling update, waits for stable
```

### Roll back
⌨️
```bash
aws ecs describe-services --region "$AWS_REGION" --cluster trekeasy-cluster \
  --services trekeasy-backend --query 'services[0].taskDefinition'      # current revision

aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster \
  --service trekeasy-backend --task-definition trekeasy-backend:<PREVIOUS_REVISION>
```

### Logs
⌨️
```bash
aws logs tail /ecs/trekeasy-backend  --region "$AWS_REGION" --follow
aws logs tail /ecs/trekeasy-frontend --region "$AWS_REGION" --since 1h
aws logs tail /ecs/trekeasy-database --region "$AWS_REGION" --since 1h
```

### Scale
⌨️
```bash
aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster \
  --service trekeasy-backend --desired-count 4
```
(or edit `BackendDesiredCount` in `03-services.yaml` and re-run `provision.sh $TAG`.)

### Change a backend env var / secret
- Non-secret: edit `Environment` in `aws/cloudformation/03-services.yaml`, then
  `./aws/scripts/provision.sh $TAG`.
- Secret: ⌨️
  ```bash
  aws secretsmanager put-secret-value --region "$AWS_REGION" \
    --secret-id trekeasy/jwt \
    --secret-string '{"JWT_SECRET":"...","JWT_REFRESH_SECRET":"..."}'
  aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster \
    --service trekeasy-backend --force-new-deployment
  ```

### Open a shell in a running task (debugging)
⌨️
```bash
aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster \
  --service trekeasy-backend --enable-execute-command --force-new-deployment
# then:
TASK=$(aws ecs list-tasks --region "$AWS_REGION" --cluster trekeasy-cluster \
  --service-name trekeasy-backend --query 'taskArns[0]' --output text)
aws ecs execute-command --region "$AWS_REGION" --cluster trekeasy-cluster \
  --task "$TASK" --container trekeasy-backend --interactive --command "/bin/sh"
```

### Tear it all down (stops billing)
⌨️
```bash
aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster --service trekeasy-frontend --desired-count 0
aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster --service trekeasy-backend  --desired-count 0
aws ecs update-service --region "$AWS_REGION" --cluster trekeasy-cluster --service trekeasy-database --desired-count 0

aws cloudformation delete-stack --region "$AWS_REGION" --stack-name trekeasy-services
aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name trekeasy-services
aws cloudformation delete-stack --region "$AWS_REGION" --stack-name trekeasy-platform
aws cloudformation wait stack-delete-complete --region "$AWS_REGION" --stack-name trekeasy-platform
aws cloudformation delete-stack --region "$AWS_REGION" --stack-name trekeasy-network
```
> ECR repos and the EFS file system have deletion protection semantics — if a
> stack delete stalls on them, 🖱️ empty the ECR repos and delete EFS in the
> console, then retry. The `trekeasy/jwt` secret is retained for 7–30 days by
> AWS before permanent deletion.

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
- [ ] 🖱️ §4.1 AWS account, `trekeasy-admin` IAM user, `aws configure`, `aws sts get-caller-identity`
- [ ] ⌨️ §4.2–4.3 `AWS_REGION`, `PROJECT_NAME`, `JWT_SECRET`, `JWT_REFRESH_SECRET` exported
- [ ] 🖱️ §4.4 GitHub OIDC provider + `trekeasy-github-deploy` role + repo secrets/vars (if using CD)
- [ ] ⌨️ §5.1 `./aws/scripts/provision.sh`
- [ ] ⌨️ §5.2 `./aws/scripts/build-and-push.sh`
- [ ] ⌨️ §5.3 `./aws/scripts/provision.sh $(git rev-parse --short HEAD)` + `ecs wait services-stable`
- [ ] ⌨️ §5.4 `curl $APP_URL/api/health` = ok
- [ ] ⌨️ §5.5 seed task run
- [ ] 🖱️ §4.5 HTTPS listener + Route 53 record (production)
- [ ] Push to `main` → CD builds, pushes, rolls the services, posts to Slack

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Service won't start, `CannotPullContainerError` | image tag not in ECR | run `build-and-push.sh` with that tag first |
| Backend task cycles, logs show `ECONNREFUSED ... 27017` | database task not up yet, or `mongo.trekeasy.local` not resolving | check `aws logs tail /ecs/trekeasy-database`; confirm the database service is `RUNNING`; Cloud Map record appears ~30 s after the task is healthy |
| Backend logs: `CORS_ORIGINS is not set; refusing all cross-origin` | `CORS_ORIGINS` empty | it is derived from the ALB DNS in `03-services.yaml`; re-run `provision.sh $TAG` |
| ALB returns 503 | no healthy targets | `aws elbv2 describe-target-health --target-group-arn <arn>`; check the container health check + security groups |
| Chat/socket disconnects every ~60 s | idle timeout too low or no stickiness | ALB idle timeout is 300 s and the backend target group has `lb_cookie` stickiness — confirm the `/socket.io/*` rule points at the backend TG |
| `expo export` OOMs in CI | Node heap | already handled by `node:20-alpine`; if it recurs, raise the frontend build's runner size |
| Mongo data lost on redeploy | task not using the EFS volume | confirm `mountPoints` `/data/db` → `mongo-data` in the database task def; EFS mount targets exist in both AZs |
| `provision.sh` fails: `JWT_SECRET: unbound variable` | secrets not exported | `export JWT_SECRET=... JWT_REFRESH_SECRET=...` (§4.3) |
| CD fails at "Configure AWS credentials" | OIDC trust / role ARN | re-check §4.4 trust policy `sub` matches `repo:<ORG>/<REPO>:*` and `AWS_DEPLOY_ROLE_ARN` secret |
