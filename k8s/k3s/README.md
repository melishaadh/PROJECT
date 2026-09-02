# K3s overlay — running K3s and Docker Compose side by side

Docker Compose keeps host **:80**. K3s/Traefik moves to host **:8081**.

Nothing in `k8s/*.yaml`, `docker-compose.yml`, `deploy/`, or the application is
changed. These two manifests are additive.

| File | What it does |
|---|---|
| `traefik-port.yaml` | `HelmChartConfig` moving Traefik's `web` entrypoint from host :80 to :8081 |
| `ingress-traefik.yaml` | A `traefik`-class Ingress, host-agnostic, so `http://localhost:8081/` routes |

## Why both files are needed

**The port.** The repo never configured Traefik — K3s installs its own from
`/var/lib/rancher/k3s/server/manifests/traefik.yaml`, and the klipper-lb
(`svclb-traefik`) DaemonSet mirrors that Service onto the host with `hostPort:
80`. That is what Docker's `-p 80:80` collides with. `HelmChartConfig` overlays
values onto the bundled chart, so the stock manifest stays untouched and a K3s
upgrade will not clobber the change.

**The class.** `k8s/ingress.yaml` declares `ingressClassName: nginx` — correct
for the documented Minikube path, but Traefik never claims an nginx-class
Ingress. On K3s that manifest is inert, so moving the port alone would still
have returned 404 on every request. `ingress-traefik.yaml` adds a `traefik`-class
Ingress with the same four routes. Each controller claims only its own class, so
Minikube and K3s both keep working.

## Apply (run on the VM)

```bash
cd ~/TREKEASY-FINAL

sudo ss -ltnp '( sport = :8081 )'          # expect empty — 8081 must be free

# Persistent: k3s re-applies this directory on every start, so it survives reboot.
sudo cp k8s/k3s/traefik-port.yaml /var/lib/rancher/k3s/server/manifests/

# k3s watches that directory and reconciles within ~30s. Only if it does not:
#   sudo systemctl restart k3s

kubectl -n kube-system rollout status ds/svclb-traefik --timeout=180s
kubectl -n kube-system get svc traefik \
  -o jsonpath='{.spec.ports[?(@.name=="web")].port}{"\n"}'    # -> 8081
sudo ss -ltnp '( sport = :80 )'            # -> empty; :80 is now free

kubectl apply -f k8s/                      # unchanged (non-recursive: skips k8s/k3s/)
kubectl apply -f k8s/k3s/ingress-traefik.yaml
kubectl -n myapp get ingress

docker compose up -d                       # reclaims the freed :80
docker compose ps
```

## Verify both at once

```bash
curl -I http://localhost/login             # 200  <- Compose (SPA route)
curl -s http://localhost/healthz           # trekeasy-nginx ok
curl -s http://localhost/api/health        # {"status":"ok",...}

curl -I http://localhost:8081/login        # 200  <- K3s/Traefik
curl -s http://localhost:8081/api/health   # {"status":"ok",...}

sudo ss -ltnp 'sport = :80 or sport = :8081'   # docker-proxy on 80, svclb on 8081
kubectl get nodes                              # K3s still Ready
```

## Rollback

```bash
sudo rm /var/lib/rancher/k3s/server/manifests/traefik-port.yaml
kubectl -n kube-system delete helmchartconfig traefik
kubectl -n myapp delete ingress trekeasy-ingress-traefik
```
