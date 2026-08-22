# Expo web export, served as a static site.
#
#   docker build -f frontend/Dockerfile -t trekeasy-frontend frontend
#
# `EXPO_PUBLIC_API_URL` must be supplied at *build* time (a build-arg), not
# just at runtime: Expo/Metro inlines `process.env.EXPO_PUBLIC_*` values into
# the bundle when it exports, same as any other Expo web build — there is no
# server process here to read an environment variable at request time. See
# docker-compose.yml, which passes it as a build arg pointing at the nginx
# reverse-proxy origin rather than at this container directly.

# ── build ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG EXPO_PUBLIC_API_URL=/api
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_NO_TELEMETRY=1

RUN npx expo export --platform web --output-dir dist

# ── runtime ──────────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html

# Client-side routing (expo-router): unknown paths fall through to
# index.html rather than nginx's default 404, so a deep link resolves inside
# the app's own router.
RUN printf 'server {\n\
    listen 8080;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
        try_files $uri $uri.html $uri/ /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
