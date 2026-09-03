#!/usr/bin/env bash

set -e

echo "Cleaning up TrekEasy Kubernetes resources..."

echo "Removing Ingress..."
sudo k3s kubectl delete -f k8s/k3s/ingress-traefik.yaml --ignore-not-found

echo "Removing frontend..."
sudo k3s kubectl delete -f k8s/frontend-service.yaml --ignore-not-found
sudo k3s kubectl delete -f k8s/frontend-deployment.yaml --ignore-not-found

echo "Removing backend..."
sudo k3s kubectl delete -f k8s/backend-hpa.yaml --ignore-not-found
sudo k3s kubectl delete -f k8s/backend-service.yaml --ignore-not-found
sudo k3s kubectl delete -f k8s/backend-deployment.yaml --ignore-not-found

echo "Removing MongoDB application..."
sudo k3s kubectl delete -f k8s/mongo-service.yaml --ignore-not-found
sudo k3s kubectl delete -f k8s/mongo-deployment.yaml --ignore-not-found

echo "Removing configuration..."
sudo k3s kubectl delete -f k8s/app-config.yaml --ignore-not-found
sudo k3s kubectl delete -f k8s/db-secret.yaml --ignore-not-found

echo
echo "MongoDB PVC has NOT been deleted."
echo "Your MongoDB data is preserved."

echo
echo "Remaining resources:"
sudo k3s kubectl get all,pvc -n myapp

echo
echo "TrekEasy cleanup complete."
