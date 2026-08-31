#!/usr/bin/env bash
#
# Build the three TrekEasy images and push them to ECR.
#
#   ./aws/scripts/build-and-push.sh [IMAGE_TAG]
#
# IMAGE_TAG defaults to the short git SHA. Every image is pushed twice: once
# under that tag (for rollback) and once under :latest (for convenience).
#
# Requires: docker, aws CLI v2, and one of `aws configure` / env credentials.
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-trekeasy}"
AWS_REGION="${AWS_REGION:-$(aws configure get region || echo us-east-1)}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_TAG="${1:-$(git rev-parse --short HEAD)}"

# Repo root, regardless of where this script is called from.
cd "$(dirname "$0")/../.."

echo ">> Logging in to ECR ($REGISTRY)"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

build_push () {
  local name="$1" dockerfile="$2" context="$3"; shift 3
  local repo="${REGISTRY}/${PROJECT_NAME}-${name}"
  echo ">> Building ${PROJECT_NAME}-${name}:${IMAGE_TAG}"
  docker build -f "$dockerfile" -t "${repo}:${IMAGE_TAG}" -t "${repo}:latest" "$@" "$context"
  docker push "${repo}:${IMAGE_TAG}"
  docker push "${repo}:latest"
}

# database: the backend-database/ Dockerfile (Mongo 7 + index bootstrap)
build_push database backend-database/Dockerfile backend-database

# backend: build context is the repo root (compiles backend/ + backend-database/)
build_push backend   backend/Dockerfile .

# frontend: EXPO_PUBLIC_API_URL is inlined at build time — keep it "/api" so the
# bundle is host-agnostic and resolves the API against the ALB it is served from.
build_push frontend  frontend/Dockerfile frontend --build-arg EXPO_PUBLIC_API_URL=/api

echo ">> Done. Pushed tag: ${IMAGE_TAG}"
