# MongoDB — the runtime service backing backend-database/ (its schemas
# compile into the backend image; this is what actually runs as data storage).
#   docker build -f backend-database/Dockerfile -t trekeasy-database backend-database

FROM mongo:7-jammy
COPY init-indexes.js /docker-entrypoint-initdb.d/init-indexes.js
EXPOSE 27017

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD mongosh --quiet --eval "db.adminCommand('ping').ok" | grep -q 1 || exit 1
