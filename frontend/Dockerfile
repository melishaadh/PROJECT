# Frontend — Expo web export, served by a minimal nginx inside the container.
#   docker build -f frontend/Dockerfile --build-arg EXPO_PUBLIC_API_URL=/api -t trekeasy-frontend:latest frontend
#
# Two stages: "build" runs `expo export` to produce a static site (dist/),
# then "runtime" is just nginx serving that static output — the Node.js
# toolchain used to build it is not in the final image.

FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./

RUN npm ci

COPY . .

ARG EXPO_PUBLIC_API_URL=/api
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

RUN npx expo export --platform web --output-dir dist

FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html

# Minimal single-page-app config: any path nginx can't find as a real file
# falls back to index.html, so client-side routing (e.g. /login, /trek/123)
# works on a hard refresh instead of 404ing.
RUN printf 'server { listen 8080; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri.html $uri/ /index.html; } }\n' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
