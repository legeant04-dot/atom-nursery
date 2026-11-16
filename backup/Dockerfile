# Atom nightly database backup — a Cloud Run JOB, not a service (docs/BACKUP.md).
# pg_dump must be >= the server's major version: atom-prod is PostgreSQL 17.
FROM node:22-alpine
RUN apk add --no-cache postgresql17-client && pg_dump --version
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Bangkok
COPY backup.js ./backup.js
USER node
CMD ["node", "backup.js"]
