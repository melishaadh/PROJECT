# `aws/` — ECS on Fargate deployment

Everything needed to run TrekEasy on **AWS ECS (Fargate launch type)** behind an
Application Load Balancer, with the tasks in private subnets.

```
aws/
├── cloudformation/
│   ├── 01-network.yaml     VPC · 2 AZs · public + private subnets · NAT
│   ├── 02-platform.yaml    ECR · ALB · IAM roles · security groups · EFS ·
│   │                       Cloud Map (mongo.trekeasy.local) · Secrets Manager
│   └── 03-services.yaml    ECS cluster · 3 task definitions · 3 services
├── task-definitions/       Stand-alone JSON copies of the 3 task defs
│                           (the CloudFormation is the source of truth)
└── scripts/
    ├── provision.sh        deploy/update the 3 CloudFormation stacks
    ├── build-and-push.sh   build the 3 images, push to ECR
    └── deploy.sh           roll the ECS services onto a new image tag
```

## What gets created

| Tier | Image (ECR repo) | Task family | ECS service | Port | Reached by |
|---|---|---|---|---|---|
| Frontend | `trekeasy-frontend` | `trekeasy-frontend` | `trekeasy-frontend` | 8080 | ALB `/` |
| Backend | `trekeasy-backend` | `trekeasy-backend` | `trekeasy-backend` | 3001 | ALB `/api` `/uploads` `/socket.io` |
| Database | `trekeasy-database` | `trekeasy-database` | `trekeasy-database` | 27017 | `mongo.trekeasy.local` (backend only) |

The ALB path routing is identical to `deploy/nginx/nginx.conf` and
`k8s/ingress.yaml`, so the frontend bundle's baked-in `/api` base URL works
unchanged — the ALB simply replaces nginx as the single front door.

## First deploy (≈15 min)

```bash
export AWS_REGION=us-east-1
export JWT_SECRET=$(openssl rand -hex 32)
export JWT_REFRESH_SECRET=$(openssl rand -hex 32)

./aws/scripts/provision.sh          # stacks: network, platform (creates the ECR repos)
./aws/scripts/build-and-push.sh     # build + push :<git-sha> and :latest
./aws/scripts/provision.sh $(git rev-parse --short HEAD)   # services stack, pinned tag
```

Open the `AppUrl` printed at the end (`http://trekeasy-alb-....elb.amazonaws.com`).

## Every subsequent release

```bash
./aws/scripts/build-and-push.sh <tag>
./aws/scripts/deploy.sh <tag>       # register new task-def revisions + rolling update
```

Rollback:

```bash
aws ecs update-service --cluster trekeasy-cluster --service trekeasy-backend \
  --task-definition trekeasy-backend:<previous-revision>
```

The full step-by-step, including the one-time AWS Console / IAM work, is in
[`../docs/RUNBOOK.md`](../docs/RUNBOOK.md).
