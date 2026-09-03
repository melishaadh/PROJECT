#!/usr/bin/env bash

set -e

usage() {
  echo "Usage: ./scripts/docker.sh {build|up|down|rebuild|images}"
  exit 1
}

case "${1:-}" in
  build)
    echo "Building TrekEasy Compose images..."
    docker compose build
    ;;

  up)
    echo "Starting TrekEasy Compose services..."
    docker compose up -d
    ;;

  down)
    echo "Stopping TrekEasy Compose services..."
    docker compose down
    ;;

  rebuild)
    echo "Rebuilding TrekEasy (down -> build -> up)..."
    docker compose down
    docker compose build
    docker compose up -d
    ;;

  images)
    echo "TrekEasy Compose images:"
    docker compose images
    ;;

  *)
    usage
    ;;
esac

echo
echo "Done."