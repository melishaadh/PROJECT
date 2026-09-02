# TrekEasy reverse proxy, built as an image so the routing config ships *inside*
# it:
#   docker build -t trekeasy-nginx:latest deploy/nginx
#
# Why this is an image and not a bind mount
# -----------------------------------------
# nginx.conf and 404.html used to be mounted as individual files:
#
#   - ./deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
#
# A single-file bind mount is bound to that file's *inode*, not its path. A
# `git pull`, a `git checkout`, an editor "atomic save" (write-new-then-rename,
# which VS Code and vim both do by default) or a OneDrive sync all replace the
# file with a new inode — and the running container goes on serving the *old*
# contents indefinitely. `docker restart` does not help; only recreating the
# container re-establishes the mount. That is how a repo whose routing rules are
# correct ends up behind a proxy that 404s.
#
# Baking the config in removes the failure mode entirely: the config can only
# change by rebuilding, and `docker compose up --build` is then the single
# source of truth.
#
# Note: no `RUN nginx -t` here, unlike frontend/Dockerfile. nginx resolves
# `proxy_pass` hostnames at config-load time, so a build-time check would fail
# with `host not found in upstream "backend"` — there is no Compose network
# during a build. This config is validated at container start instead, where
# `backend` and `frontend` actually resolve.

FROM nginx:alpine

COPY nginx.conf          /etc/nginx/nginx.conf
COPY proxy_headers.conf  /etc/nginx/proxy_headers.conf
COPY 404.html            /usr/share/nginx/html/404.html

EXPOSE 80

# Answers only if *this* config is live — see the /healthz note in nginx.conf.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/healthz | grep -q ok || exit 1
