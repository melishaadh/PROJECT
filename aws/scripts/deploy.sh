#!/usr/bin/env bash
#
# Roll the running ECS services onto a new image tag.
#
#   ./aws/scripts/deploy.sh [IMAGE_TAG]
#
# For each service it takes the CURRENT task definition, swaps only the image
# tag, registers a new revision, and points the service at it — a normal ECS
# rolling update (old tasks drain, new tasks come up behind the ALB health
# check). Roll back with:
#
#   aws ecs update-service --cluster trekeasy-cluster \
#     --service trekeasy-backend --task-definition trekeasy-backend:<OLD_REVISION>
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-trekeasy}"
AWS_REGION="${AWS_REGION:-$(aws configure get region || echo us-east-1)}"
CLUSTER="${PROJECT_NAME}-cluster"
IMAGE_TAG="${1:-$(git rev-parse --short HEAD)}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

roll () {
  local tier="$1"
  local family="${PROJECT_NAME}-${tier}"
  local image="${REGISTRY}/${PROJECT_NAME}-${tier}:${IMAGE_TAG}"
  echo ">> ${family}: -> ${image}"

  local current
  current="$(aws ecs describe-task-definition --task-definition "$family" \
    --region "$AWS_REGION" --query 'taskDefinition')"

  # Strip the read-only fields AWS rejects on register, then set the new image.
  local new_def
  new_def="$(echo "$current" | jq --arg IMG "$image" '
    .containerDefinitions[0].image = $IMG
    | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
          .compatibilities, .registeredAt, .registeredBy)')"

  local new_arn
  new_arn="$(aws ecs register-task-definition --region "$AWS_REGION" \
    --cli-input-json "$new_def" --query 'taskDefinition.taskDefinitionArn' --output text)"
  echo "   registered $new_arn"

  aws ecs update-service --region "$AWS_REGION" --cluster "$CLUSTER" \
    --service "$family" --task-definition "$new_arn" >/dev/null
}

# Order matters: database first, then backend, then frontend.
roll database
roll backend
roll frontend

echo ">> Waiting for services to stabilize..."
aws ecs wait services-stable --region "$AWS_REGION" --cluster "$CLUSTER" \
  --services "${PROJECT_NAME}-database" "${PROJECT_NAME}-backend" "${PROJECT_NAME}-frontend"

echo ">> Deploy complete: ${IMAGE_TAG}"
aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "${PROJECT_NAME}-platform" \
  --query 'Stacks[0].Outputs[?OutputKey==`AppUrl`].OutputValue' --output text
