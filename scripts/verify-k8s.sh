#!/usr/bin/env bash

echo "Checking TrekEasy Kubernetes deployment..."
echo

echo "=== K3s Nodes ==="
sudo k3s kubectl get nodes

echo
echo "=== TrekEasy Pods ==="
sudo k3s kubectl get pods -n myapp

echo
echo "=== TrekEasy Services ==="
sudo k3s kubectl get svc -n myapp

echo
echo "=== Deployments ==="
sudo k3s kubectl get deployments -n myapp

echo
echo "=== MongoDB PVC ==="
sudo k3s kubectl get pvc -n myapp

echo
echo "=== Backend HPA ==="
sudo k3s kubectl get hpa -n myapp

echo
echo "=== Ingress ==="
sudo k3s kubectl get ingress -n myapp

echo
echo "=== Traefik ==="
sudo k3s kubectl get pods -n kube-system | grep traefik

echo
echo "=== Traefik Service ==="
sudo k3s kubectl get svc traefik -n kube-system

echo
echo "Kubernetes verification complete."
