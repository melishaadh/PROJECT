# TrekEasy reverse proxy — ECS/Fargate image. Same idea as ../nginx/Dockerfile
# (routing config baked into the image, never bind-mounted), but built from
# deploy/nginx-ecs/nginx.conf, which talks to the backend and frontend
# containers over 127.0.0.1 instead of Compose service names — see the
# comment at the top of nginx.conf for why.
#
#   docker build -t trekeasy-nginx:ecs deploy/nginx-ecs
#
# This is the image aws/scripts/build-and-push.sh pushes to both Docker Hub
# and the trekeasy-nginx ECR repo, and aws/scripts/deploy.sh rolls the ECS
# service onto. deploy/nginx/Dockerfile (the Compose image) must never be
# used for that — its config resolves `backend`/`frontend`, which don't
# exist in an ECS task's network namespace.
#
# Note: no `RUN nginx -t` here on purpose, same reasoning as the Compose
# Dockerfile — nginx would need to resolve the upstreams at build time.
# 127.0.0.1 always resolves, but keeping this consistent with the Compose
# image avoids the two configs silently drifting in how they're validated.

FROM nginx:alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY 404.html   /usr/share/nginx/html/404.html

EXPOSE 80

# Answers only if *this* config is live — see the /healthz note in nginx.conf.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1/healthz | grep -q ok || exit 1
