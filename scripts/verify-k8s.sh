#!/usr/bin/env bash
# Read-only health check for the TrekEasy K3s + Traefik deployment.
#
# Checks node health, the `myapp` namespace, the mongo/backend/frontend
# Deployments and Services, the backend HPA, the Traefik controller
# (kube-system), and the k3s-specific Ingress (k8s/k3s/ingress-traefik.yaml).
# Makes no changes to the cluster — safe to run at any time.
#
# Usage:
#   ./scripts/verify-k8s.sh
#
# Exit code: 0 if every check passes, 1 if any check fails.
# Warnings (e.g. metrics-server missing, so the HPA can't report CPU) do not
# fail the script — they're printed but don't affect the exit code.

set -euo pipefail

KUBECTL=(sudo k3s kubectl)
NAMESPACE="myapp"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INGRESS_MANIFEST="$REPO_ROOT/k8s/k3s/ingress-traefik.yaml"

FAILS=0
WARNS=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }
warn() { echo "  ! $*"; WARNS=$((WARNS + 1)); }
section() { echo; echo "==> $*"; }

kc() { "${KUBECTL[@]}" "$@"; }

section "K3s / node health"
if ! command -v k3s >/dev/null 2>&1; then
  fail "k3s binary not found on this host"
else
  pass "k3s binary present"
fi

if kc get nodes >/tmp/verify-k8s-nodes.$$ 2>/tmp/verify-k8s-nodes.err.$$; then
  NOT_READY="$(awk 'NR>1 && $2!="Ready" {print $1}' /tmp/verify-k8s-nodes.$$)"
  if [ -z "$NOT_READY" ]; then
    pass "all nodes Ready ($(awk 'NR>1' /tmp/verify-k8s-nodes.$$ | wc -l) node(s))"
  else
    fail "node(s) not Ready: $NOT_READY"
  fi
else
  fail "could not reach the K3s API server (sudo k3s kubectl get nodes failed): $(cat /tmp/verify-k8s-nodes.err.$$)"
fi
rm -f /tmp/verify-k8s-nodes.$$ /tmp/verify-k8s-nodes.err.$$

section "Namespace: $NAMESPACE"
if kc get namespace "$NAMESPACE" >/dev/null 2>&1; then
  pass "namespace '$NAMESPACE' exists"
else
  fail "namespace '$NAMESPACE' not found"
fi

# Reports Deployment readiness (desired vs. available replicas) without ever
# naming a pod directly — pod status is read via the deployment's own rollout
# state, which stays valid across restarts/rescheduling.
check_deployment() {
  local name="$1"
  local desired available
  if ! kc get deployment "$name" -n "$NAMESPACE" >/dev/null 2>&1; then
    fail "deployment/$name not found in $NAMESPACE"
    return
  fi
  desired="$(kc get deployment "$name" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}')"
  available="$(kc get deployment "$name" -n "$NAMESPACE" -o jsonpath='{.status.availableReplicas}')"
  available="${available:-0}"
  if [ "$available" -ge "$desired" ] && [ "$desired" -gt 0 ]; then
    pass "deployment/$name ready ($available/$desired available)"
  else
    fail "deployment/$name not ready ($available/$desired available)"
  fi
}

# Reports pod health for a Deployment via its label selector, so no pod name
# is ever hard-coded.
check_pods() {
  local label="$1"
  local total not_running
  total="$(kc get pods -n "$NAMESPACE" -l "$label" --no-headers 2>/dev/null | wc -l)"
  if [ "$total" -eq 0 ]; then
    fail "no pods found for selector '$label' in $NAMESPACE"
    return
  fi
  not_running="$(kc get pods -n "$NAMESPACE" -l "$label" --no-headers 2>/dev/null | awk '$3!="Running" && $3!="Completed" {print $1, $3}')"
  if [ -z "$not_running" ]; then
    pass "pods matching '$label' Running ($total pod(s))"
  else
    fail "pods matching '$label' not healthy: $not_running"
  fi
}

section "Mongo (Deployment/PVC)"
check_deployment "mongo"
check_pods "app=mongo"
if kc get pvc mongo-pvc -n "$NAMESPACE" >/dev/null 2>&1; then
  PVC_STATUS="$(kc get pvc mongo-pvc -n "$NAMESPACE" -o jsonpath='{.status.phase}')"
  if [ "$PVC_STATUS" = "Bound" ]; then
    pass "pvc/mongo-pvc Bound"
  else
    fail "pvc/mongo-pvc not Bound (status: $PVC_STATUS)"
  fi
else
  fail "pvc/mongo-pvc not found"
fi

section "Backend (Deployment/Service/HPA)"
check_deployment "backend"
check_pods "app=backend"
if kc get svc backend-service -n "$NAMESPACE" >/dev/null 2>&1; then
  NODEPORT="$(kc get svc backend-service -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].nodePort}')"
  pass "svc/backend-service exists (NodePort $NODEPORT)"
else
  fail "svc/backend-service not found"
fi
if kc get hpa backend-hpa -n "$NAMESPACE" >/dev/null 2>&1; then
  MIN="$(kc get hpa backend-hpa -n "$NAMESPACE" -o jsonpath='{.spec.minReplicas}')"
  MAX="$(kc get hpa backend-hpa -n "$NAMESPACE" -o jsonpath='{.spec.maxReplicas}')"
  CURRENT_CPU="$(kc get hpa backend-hpa -n "$NAMESPACE" -o jsonpath='{.status.currentMetrics[0].resource.current.averageUtilization}' 2>/dev/null || true)"
  if [ -n "$CURRENT_CPU" ]; then
    pass "hpa/backend-hpa active ($MIN-$MAX replicas, CPU ${CURRENT_CPU}%)"
  else
    warn "hpa/backend-hpa exists ($MIN-$MAX replicas) but reports no CPU metric yet — is metrics-server installed?"
  fi
else
  fail "hpa/backend-hpa not found"
fi

section "Frontend (Deployment/Service)"
check_deployment "frontend"
check_pods "app=frontend"
if kc get svc frontend-service -n "$NAMESPACE" >/dev/null 2>&1; then
  pass "svc/frontend-service exists"
else
  fail "svc/frontend-service not found"
fi

section "Service endpoints"
check_endpoints() {
  local svc="$1"
  local addrs
  addrs="$(kc get endpoints "$svc" -n "$NAMESPACE" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
  if [ -n "$addrs" ]; then
    pass "endpoints/$svc backed by: $addrs"
  else
    fail "endpoints/$svc has no ready backends"
  fi
}
check_endpoints "mongo"
check_endpoints "backend-service"
check_endpoints "frontend-service"

section "Traefik (kube-system) + k3s Ingress manifest"
if [ -f "$INGRESS_MANIFEST" ]; then
  pass "manifest present: k8s/k3s/ingress-traefik.yaml"
else
  fail "manifest missing: k8s/k3s/ingress-traefik.yaml"
fi

TRAEFIK_PODS_NOT_RUNNING="$(kc get pods -n kube-system -l app.kubernetes.io/name=traefik --no-headers 2>/dev/null | awk '$3!="Running" {print $1, $3}')"
TRAEFIK_POD_COUNT="$(kc get pods -n kube-system -l app.kubernetes.io/name=traefik --no-headers 2>/dev/null | wc -l)"
if [ "$TRAEFIK_POD_COUNT" -gt 0 ] && [ -z "$TRAEFIK_PODS_NOT_RUNNING" ]; then
  pass "traefik controller Running in kube-system ($TRAEFIK_POD_COUNT pod(s))"
elif [ "$TRAEFIK_POD_COUNT" -gt 0 ]; then
  fail "traefik controller unhealthy: $TRAEFIK_PODS_NOT_RUNNING"
else
  fail "no traefik pods found in kube-system"
fi

if kc get svc traefik -n kube-system >/dev/null 2>&1; then
  WEB_PORT="$(kc get svc traefik -n kube-system -o jsonpath='{.spec.ports[?(@.name=="web")].port}')"
  pass "svc/traefik exists in kube-system (web port: ${WEB_PORT:-unset})"
else
  fail "svc/traefik not found in kube-system"
fi

if kc get ingress trekeasy-ingress-traefik -n "$NAMESPACE" >/dev/null 2>&1; then
  CLASS="$(kc get ingress trekeasy-ingress-traefik -n "$NAMESPACE" -o jsonpath='{.spec.ingressClassName}')"
  if [ "$CLASS" = "traefik" ]; then
    pass "ingress/trekeasy-ingress-traefik exists (class: traefik)"
  else
    fail "ingress/trekeasy-ingress-traefik has unexpected class: $CLASS"
  fi
else
  fail "ingress/trekeasy-ingress-traefik not found in $NAMESPACE"
fi

section "Ingress routing (best-effort)"
if command -v curl >/dev/null 2>&1 && [ -n "${WEB_PORT:-}" ]; then
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://localhost:${WEB_PORT}/api/health" || echo "000")"
  if [ "$CODE" = "200" ]; then
    pass "http://localhost:${WEB_PORT}/api/health -> 200"
  else
    warn "http://localhost:${WEB_PORT}/api/health -> $CODE (cluster may not be reachable from this host, or backend still starting)"
  fi
else
  warn "curl not available or Traefik web port unknown — skipping live routing check"
fi

echo
echo "==> Summary: $FAILS failing check(s), $WARNS warning(s)"
if [ "$FAILS" -gt 0 ]; then
  exit 1
fi
exit 0
