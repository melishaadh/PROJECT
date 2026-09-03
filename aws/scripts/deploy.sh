#!/usr/bin/env bash
# Roll the existing ECS service onto a new image tag.
#
# This does NOT create the cluster, service, task definition family, IAM
# roles, log groups, or networking — all of that already exists and is
# managed outside this repo. This script only:
#   1. reads the task definition currently running on the service
#   2. swaps in the new image tag for any container using one of the three
#      TrekEasy ECR repos
#   3. registers that as a new task definition revision
#   4. points the service at it and waits for the rollout to finish
#
# Usage:
#   ./aws/scripts/deploy.sh <tag>
#
# Required: aws CLI (configured/authenticated) and jq.
# Optional env:
#   AWS_REGION       default: ap-south-1
#   ECS_CLUSTER      default: trekeasy-cluster
#   ECS_SERVICE      default: trekeasy-service
#   BACKEND_ECR_REPO  / FRONTEND_ECR_REPO / NGINX_ECR_REPO  (see build-and-push.sh)

set -euo pipefail

TAG="${1:?usage: deploy.sh <tag>}"

AWS_REGION="${AWS_REGION:-ap-south-1}"
ECS_CLUSTER="${ECS_CLUSTER:-trekeasy-cluster}"
ECS_SERVICE="${ECS_SERVICE:-trekeasy-service}"
BACKEND_ECR_REPO="${BACKEND_ECR_REPO:-trekeasy-backend}"
FRONTEND_ECR_REPO="${FRONTEND_ECR_REPO:-trekeasy-frontend}"
NGINX_ECR_REPO="${NGINX_ECR_REPO:-trekeasy-nginx}"

echo "==> Looking up the task definition running on ${ECS_SERVICE}"
CURRENT_TASK_DEF_ARN="$(aws ecs describe-services \
  --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
  --query 'services[0].taskDefinition' --output text)"

if [ -z "$CURRENT_TASK_DEF_ARN" ] || [ "$CURRENT_TASK_DEF_ARN" = "None" ]; then
  echo "error: could not find service ${ECS_SERVICE} in cluster ${ECS_CLUSTER} (region ${AWS_REGION})" >&2
  exit 1
fi
echo "    current: $CURRENT_TASK_DEF_ARN"

TASK_DEF_JSON="$(aws ecs describe-task-definition \
  --region "$AWS_REGION" --task-definition "$CURRENT_TASK_DEF_ARN" \
  --query 'taskDefinition')"

echo "==> Repointing container images at tag ${TAG}"
NEW_TASK_DEF_JSON="$(echo "$TASK_DEF_JSON" | jq \
  --arg tag "$TAG" \
  --arg backend "$BACKEND_ECR_REPO" \
  --arg frontend "$FRONTEND_ECR_REPO" \
  --arg nginx "$NGINX_ECR_REPO" '
  # Strip the read-only fields that register-task-definition rejects.
  del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
      .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
  | .containerDefinitions = [
      .containerDefinitions[] | (
        if (.image | test("/(" + $backend + "|" + $frontend + "|" + $nginx + "):"))
        then .image |= sub("(?<repo>/(" + $backend + "|" + $frontend + "|" + $nginx + "):)[^:]*$"; "\(.repo)\($tag)")
        else .
        end
      )
    ]
')"

echo "==> Registering new task definition revision"
NEW_TASK_DEF_ARN="$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "$NEW_TASK_DEF_JSON" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
echo "    new: $NEW_TASK_DEF_ARN"

echo "==> Updating ${ECS_SERVICE} to use it"
aws ecs update-service \
  --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
  --task-definition "$NEW_TASK_DEF_ARN" \
  --query 'service.serviceName' --output text >/dev/null

echo "==> Waiting for the service to stabilize"
aws ecs wait services-stable \
  --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"

echo "==> Deploy complete: ${ECS_SERVICE} is running ${NEW_TASK_DEF_ARN} (tag ${TAG})"
