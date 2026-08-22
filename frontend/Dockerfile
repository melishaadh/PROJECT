# Expo web export, served as a static site on port 8080.
#   docker build -f frontend/Dockerfile -t trekeasy-frontend frontend
#
# EXPO_PUBLIC_API_URL is baked into the bundle at build time (Expo/Metro
# inlines process.env.EXPO_PUBLIC_* on export) — pass it as --build-arg.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG EXPO_PUBLIC_API_URL=/api
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
RUN npx expo export --platform web --output-dir dist

FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server { listen 8080; root /usr/share/nginx/html; index index.html; \
  location / { try_files $uri $uri.html $uri/ /index.html; } }\n' \
  > /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
