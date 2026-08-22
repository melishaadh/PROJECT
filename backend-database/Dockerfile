# Runtime identity of the "backend-database" microservice.
#
# backend-database/ itself has no server of its own — it's the shared
# Mongoose schema/config source `backend/` compiles into its build (see
# backend/tsconfig.json's `rootDir: ".."` and backend/src/register-aliases.ts).
# What actually runs as the third service is MongoDB; this Dockerfile is that
# runtime, extended with one real thing this directory owns: pre-creating the
# constraint indexes its schemas declare (see init-indexes.js) before the API
# ever connects.
#
#   docker build -f backend-database/Dockerfile -t trekeasy-mongo backend-database

FROM mongo:7-jammy

COPY init-indexes.js /docker-entrypoint-initdb.d/init-indexes.js

EXPOSE 27017

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD mongosh --quiet --eval "db.adminCommand('ping').ok" | grep -q 1 || exit 1
