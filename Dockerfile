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
# pg_engine lifts leaveTypeTH_ from here (leave used) — the same code Apps Script runs
COPY src/Leave.gs               src/Leave.gs
# server/gate.js runs Code.gs's OWN door (applyIdentity_, ADMIN_ONLY, CLOSED_ROUTES_, ROUTES) — it
# loads these whole, the same files Apps Script runs. Source code only; no secret lives in any of them.
COPY src/Code.gs                src/Code.gs
COPY src/Db.gs                  src/Db.gs
COPY src/Checkin.gs             src/Checkin.gs
COPY src/Audit.gs               src/Audit.gs
COPY src/Auth.gs                src/Auth.gs
COPY src/Notify.gs              src/Notify.gs
# server/routes.js runs getPayslip (Payroll.gs) and insuranceStatus (Day6.gs) — the handlers themselves
COPY src/Payroll.gs             src/Payroll.gs
COPY src/Day6.gs                src/Day6.gs
# ...myPayslipMonths/otCarryOver (OtStaff.gs helpers), otWaiveDays (OT.gs), certText (Certificate.gs)
COPY src/OtStaff.gs             src/OtStaff.gs
COPY src/OT.gs                  src/OT.gs
COPY src/Certificate.gs         src/Certificate.gs
# W1 write routes (2026-11-07): logAudit (Audit) · departments/quota (Staff) · getStudent_ (Dspm) · DSPM criteria (DspmAdmin) · child leave (Parent) · unlockJournal (Journal) · announcements (Announce)
COPY src/Staff.gs               src/Staff.gs
COPY src/Dspm.gs                src/Dspm.gs
COPY src/DspmAdmin.gs           src/DspmAdmin.gs
COPY src/Parent.gs              src/Parent.gs
COPY src/Journal.gs             src/Journal.gs
COPY src/Announce.gs            src/Announce.gs
COPY docs/schema/001_init.sql   docs/schema/001_init.sql
COPY server/host.js             server/host.js
COPY server/session.js          server/session.js
COPY server/gate.js             server/gate.js
COPY server/write_proven.js     server/write_proven.js
COPY server/routes.js           server/routes.js

# Cloud Run supplies PORT (8080); host.js reads it
USER node
CMD ["node", "server/host.js"]
