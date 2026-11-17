# Atom restore drill — a Cloud Run JOB (docs/BACKUP.md "ซ้อมกู้").
# Starts an EMPTY PostgreSQL 17 inside this container, restores the newest backup into it, and
# compares every table with atom-prod. Nothing is restored anywhere else; the container and the
# restored copy vanish when the job ends.
FROM node:22-alpine
RUN apk add --no-cache postgresql17 postgresql17-client postgresql17-contrib \
 && ln -sf /usr/libexec/postgresql17/initdb /usr/local/bin/initdb \
 && ln -sf /usr/libexec/postgresql17/pg_ctl /usr/local/bin/pg_ctl \
 && initdb --version && pg_ctl --version && pg_restore --version
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Bangkok
COPY drill.js ./drill.js
# initdb refuses to run as root; the alpine package creates this user
USER postgres
CMD ["node", "drill.js"]
