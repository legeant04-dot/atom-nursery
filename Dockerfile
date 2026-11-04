# Atom fast host — the same engine on Postgres, for Google Cloud Run (asia-southeast1 · Singapore)
# docs/CLOUD_RUN.md is the runbook. Built from the repo root:  gcloud run deploy --source .
#
# 🔴 What goes INTO the image is listed file by file below, and what may even be UPLOADED to build it
#    is whitelisted in .gcloudignore. secrets/, the signature, the certificate artwork and every
#    student-facing asset stay on this machine. The database password reaches the container only as
#    an environment variable from Secret Manager (SUPABASE_DB_URL) — never a file, never a layer.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# one dependency: the Postgres driver
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# the engine is the SAME file the app and Apps Script run — no second implementation
COPY webapp/engine.js           webapp/engine.js
COPY tools/pg_lib.js            tools/pg_lib.js
COPY tools/pg_engine.js         tools/pg_engine.js
COPY tools/pg_migrate.js        tools/pg_migrate.js
# pg_engine maps sheet columns to table columns by READING these, at start-up
COPY src/Config.gs              src/Config.gs
COPY src/GasEngine.gs           src/GasEngine.gs
COPY docs/schema/001_init.sql   docs/schema/001_init.sql
COPY server/host.js             server/host.js
COPY server/session.js          server/session.js

# Cloud Run supplies PORT (8080); host.js reads it
USER node
CMD ["node", "server/host.js"]
