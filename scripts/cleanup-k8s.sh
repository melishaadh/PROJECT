#!/usr/bin/env bash
# Remove TrekEasy's application resources from the `myapp` namespace.
#
# By default this PRESERVES the MongoDB PVC (mongo-pvc) — the actual database
# data — and the `myapp` namespace itself. It only deletes the objects
# ./scripts/deploy-k8s.sh creates: the Ingress, the backend/frontend/mongo
# Deployments and Services, the backend HPA, and the app-config/db-secret.
#
# Never touches: K3s itself, the Traefik controller or any kube-system
# resource, Docker/Docker Compose state, or any namespace other than myapp.
#
# Usage:
#   ./scripts/cleanup-k8s.sh                 # keep the Mongo PVC (default, safe)
#   ./scripts/cleanup-k8s.sh --delete-data    # also delete the Mongo PVC, after
#                                              # an interactive typed confirmation
#
# The namespace itself is intentionally left in place: deleting it would
# cascade-delete the PVC (and its data) even when --delete-data was not given.

set -euo pipefail

KUBECTL=(sudo k3s kubectl)
NAMESPACE="myapp"
DELETE_DATA=false

for arg in "$@"; do
  case "$arg" in
    --delete-data)
      DELETE_DATA=true
      ;;
    *)
      echo "error: unknown argument '$arg' (expected: --delete-data)" >&2
      exit 1
      ;;
  esac
done

kc() { "${KUBECTL[@]}" "$@"; }

delete() {
  local kind="$1" name="$2"
  if kc get "$kind" "$name" -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "==> Deleting $kind/$name"
    kc delete "$kind" "$name" -n "$NAMESPACE" --ignore-not-found
  else
    echo "==> Skipping $kind/$name (not found)"
  fi
}

echo "==> Cleaning up TrekEasy application resources in namespace '$NAMESPACE'"
echo "    (the '$NAMESPACE' namespace and mongo-pvc are preserved unless --delete-data is given)"
echo

echo "==> Ingress"
delete ingress trekeasy-ingress-traefik
delete ingress trekeasy-ingress

echo
echo "==> HPA"
delete hpa backend-hpa

echo
echo "==> Services"
delete service backend-service
delete service frontend-service
delete service mongo

echo
echo "==> Deployments"
delete deployment backend
delete deployment frontend
delete deployment mongo

echo
echo "==> Config/secret"
delete configmap app-config
delete secret db-secret

echo
if kc get pvc mongo-pvc -n "$NAMESPACE" >/dev/null 2>&1; then
  if [ "$DELETE_DATA" = true ]; then
    echo "==> --delete-data was given: pvc/mongo-pvc and ALL MongoDB DATA WILL BE PERMANENTLY DELETED."
    echo "    This cannot be undone."
    CONFIRM=""
    if [ -r /dev/tty ]; then
      read -r -p "    Type 'delete mongo-pvc' to confirm: " CONFIRM </dev/tty || true
    fi
    if [ "$CONFIRM" = "delete mongo-pvc" ]; then
      echo "==> Deleting pvc/mongo-pvc"
      kc delete pvc mongo-pvc -n "$NAMESPACE" --ignore-not-found
    else
      echo "==> Confirmation not received — pvc/mongo-pvc preserved."
    fi
  else
    echo "==> Preserving pvc/mongo-pvc (MongoDB data). Pass --delete-data to remove it."
  fi
else
  echo "==> pvc/mongo-pvc not found (nothing to preserve or delete)"
fi

echo
echo "==> Cleanup complete. Remaining resources in '$NAMESPACE':"
kc get all,pvc,configmap,secret,ingress -n "$NAMESPACE"
