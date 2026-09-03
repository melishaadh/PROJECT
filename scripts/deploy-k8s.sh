#!/usr/bin/env bash

set -e

echo "Deploying TrekEasy to Kubernetes..."

echo "1. Creating namespace..."
sudo k3s kubectl apply -f k8s/namespace.yaml

echo "2. Applying configuration..."
sudo k3s kubectl apply -f k8s/app-config.yaml
sudo k3s kubectl apply -f k8s/db-secret.yaml

echo "3. Deploying MongoDB..."
sudo k3s kubectl apply -f k8s/mongo-pvc.yaml
sudo k3s kubectl apply -f k8s/mongo-deployment.yaml
sudo k3s kubectl apply -f k8s/mongo-service.yaml

echo "4. Deploying backend..."
sudo k3s kubectl apply -f k8s/backend-deployment.yaml
sudo k3s kubectl apply -f k8s/backend-service.yaml
sudo k3s kubectl apply -f k8s/backend-hpa.yaml

echo "5. Deploying frontend..."
sudo k3s kubectl apply -f k8s/frontend-deployment.yaml
sudo k3s kubectl apply -f k8s/frontend-service.yaml

echo "6. Applying Traefik Ingress..."
sudo k3s kubectl apply -f k8s/k3s/ingress-traefik.yaml

echo
echo "Waiting for deployments..."

sudo k3s kubectl rollout status deployment/mongo -n myapp --timeout=180s
sudo k3s kubectl rollout status deployment/backend -n myapp --timeout=180s
sudo k3s kubectl rollout status deployment/frontend -n myapp --timeout=180s

echo
echo "TrekEasy deployment complete!"
echo
echo "Pods:"
sudo k3s kubectl get pods -n myapp

echo
echo "Services:"
sudo k3s kubectl get svc -n myapp

echo
echo "Ingress:"
sudo k3s kubectl get ingress -n myapp
