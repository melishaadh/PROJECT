#!/usr/bin/env bash
# Build the three TrekEasy images ONCE each and push the same immutable tag
# to both registries: Docker Hub (secondary/mirror) and ECR (what ECS
# actually pulls from). This script does not create or modify any AWS or
# Docker Hub resources — the ECR repos, Docker Hub repos, ECS cluster and
# service all already exist. It only builds and pushes images.
#
# Docker auth is NOT handled here: the caller (CI) is expected to have
# already run `docker login` against both registries before invoking this
# script — see .github/workflows/cd.yml, which uses
# aws-actions/amazon-ecr-login for ECR and docker/login-action for Docker
# Hub. Keeping login out of this script means it never needs to see a
# token/password, only registry hostnames and repo names.
#
# Usage:
#   ./aws/scripts/build-and-push.sh <tag>
#
# Required env:
#   ECR_REGISTRY           <account>.dkr.ecr.<region>.amazonaws.com
#                           (the `registry` output of aws-actions/amazon-ecr-login)
# Optional env:
#   BACKEND_ECR_REPO       default: trekeasy-backend
#   FRONTEND_ECR_REPO      default: trekeasy-frontend
#   NGINX_ECR_REPO         default: trekeasy-nginx
#   DOCKERHUB_BACKEND_REPO  default: melishaadh/trekeasy-backend
#   DOCKERHUB_FRONTEND_REPO default: melishaadh/trekeasy-frontend
#   DOCKERHUB_NGINX_REPO    default: melishaadh/trekeasy-nginx
#   EXPO_PUBLIC_API_URL    build-arg baked into the frontend bundle (default: /api)

set -euo pipefail

TAG="${1:?usage: build-and-push.sh <tag>}"

: "${ECR_REGISTRY:?ECR_REGISTRY is required (registry output of aws-actions/amazon-ecr-login)}"

BACKEND_ECR_REPO="${BACKEND_ECR_REPO:-trekeasy-backend}"
FRONTEND_ECR_REPO="${FRONTEND_ECR_REPO:-trekeasy-frontend}"
NGINX_ECR_REPO="${NGINX_ECR_REPO:-trekeasy-nginx}"

DOCKERHUB_BACKEND_REPO="${DOCKERHUB_BACKEND_REPO:-melishaadh/trekeasy-backend}"
DOCKERHUB_FRONTEND_REPO="${DOCKERHUB_FRONTEND_REPO:-melishaadh/trekeasy-frontend}"
DOCKERHUB_NGINX_REPO="${DOCKERHUB_NGINX_REPO:-melishaadh/trekeasy-nginx}"

EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-/api}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Builds one image exactly once, then tags the same image ID for ECR and
# Docker Hub and pushes both — no second `docker build`, so the bits
# running in ECS are byte-identical to the ones mirrored on Docker Hub.
build_and_push() {
  local ecr_repo="$1" dockerhub_repo="$2" dockerfile="$3" context="$4"; shift 4
  local ecr_image="${ECR_REGISTRY}/${ecr_repo}"

  echo "==> Building ${ecr_repo} (once)"
  docker build -f "$dockerfile" -t "${ecr_image}:${TAG}" "$@" "$context"
  docker tag "${ecr_image}:${TAG}" "${ecr_image}:latest"
  docker tag "${ecr_image}:${TAG}" "${dockerhub_repo}:${TAG}"
  docker tag "${ecr_image}:${TAG}" "${dockerhub_repo}:latest"

  echo "==> Pushing to ECR: ${ecr_image}:${TAG} and :latest"
  docker push "${ecr_image}:${TAG}"
  docker push "${ecr_image}:latest"

  echo "==> Pushing to Docker Hub: ${dockerhub_repo}:${TAG} and :latest"
  docker push "${dockerhub_repo}:${TAG}"
  docker push "${dockerhub_repo}:latest"
}

# Backend: build context is the repo root, because backend/tsconfig.json
# compiles backend/ and backend-database/ together (see backend/Dockerfile).
build_and_push "$BACKEND_ECR_REPO" "$DOCKERHUB_BACKEND_REPO" backend/Dockerfile "$REPO_ROOT"

# Frontend: EXPO_PUBLIC_API_URL is baked into the JS bundle at build time.
build_and_push "$FRONTEND_ECR_REPO" "$DOCKERHUB_FRONTEND_REPO" frontend/Dockerfile "$REPO_ROOT/frontend" \
  --build-arg "EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"

# nginx reverse proxy: routing config is baked into the image (see
# deploy/nginx-ecs/Dockerfile) — never bind-mounted. This MUST be the ECS
# variant (127.0.0.1 upstreams), not deploy/nginx/Dockerfile (the Compose
# variant, which resolves `backend`/`frontend` service names that don't
# exist in an ECS task's shared network namespace) — see
# deploy/nginx-ecs/nginx.conf for why. The same ECS-targeted image is what
# gets mirrored to Docker Hub, so a tag means the same image everywhere.
build_and_push "$NGINX_ECR_REPO" "$DOCKERHUB_NGINX_REPO" deploy/nginx-ecs/Dockerfile "$REPO_ROOT/deploy/nginx-ecs"

echo "==> Done. Pushed tag: ${TAG}"
