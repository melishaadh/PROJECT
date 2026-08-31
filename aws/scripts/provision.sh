#!/usr/bin/env bash
#
# Infrastructure provisioning via CloudFormation. Idempotent — re-running
# applies only what changed (change sets).
#
#   # 1. network + platform only (safe on a fresh account, creates the ECR repos)
#   JWT_SECRET=... JWT_REFRESH_SECRET=... ./aws/scripts/provision.sh
#
#   # 2. ...then push images (aws/scripts/build-and-push.sh)...
#
#   # 3. add / update the ECS services, pinned to an image tag that now exists
#   JWT_SECRET=... JWT_REFRESH_SECRET=... ./aws/scripts/provision.sh <IMAGE_TAG>
#
# Stacks:
#   trekeasy-network   VPC, subnets, NAT
#   trekeasy-platform  ECR, ALB, IAM, EFS, Cloud Map, Secrets Manager
#   trekeasy-services  ECS cluster + services   (only when IMAGE_TAG is given)
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-trekeasy}"
AWS_REGION="${AWS_REGION:-$(aws configure get region || echo us-east-1)}"
IMAGE_TAG="${1:-}"
CF_DIR="$(dirname "$0")/../cloudformation"

: "${JWT_SECRET:?set JWT_SECRET (openssl rand -hex 32)}"
: "${JWT_REFRESH_SECRET:?set JWT_REFRESH_SECRET (openssl rand -hex 32)}"

deploy () {
  local stack="$1" template="$2"; shift 2
  echo ">> Deploying stack: $stack"
  aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$stack" \
    --template-file "$template" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides "ProjectName=${PROJECT_NAME}" "$@"
}

deploy "${PROJECT_NAME}-network"  "${CF_DIR}/01-network.yaml"
deploy "${PROJECT_NAME}-platform" "${CF_DIR}/02-platform.yaml" \
  "JwtSecret=${JWT_SECRET}" "JwtRefreshSecret=${JWT_REFRESH_SECRET}"

if [ -n "$IMAGE_TAG" ]; then
  deploy "${PROJECT_NAME}-services" "${CF_DIR}/03-services.yaml" "ImageTag=${IMAGE_TAG}"
else
  echo ">> Skipping the services stack (no IMAGE_TAG given)."
  echo "   Next: ./aws/scripts/build-and-push.sh   then re-run with a tag."
fi

echo
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "${PROJECT_NAME}-platform" \
  --query 'Stacks[0].Outputs[?OutputKey==`AppUrl`].OutputValue' --output text
