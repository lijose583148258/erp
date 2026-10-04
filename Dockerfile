FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/packages ./backend/packages
RUN npm ci
RUN cd backend && npm ci

COPY . .
RUN npm run build
RUN npm run build:backend

FROM node:20-bookworm-slim AS production
WORKDIR /app

ENV NODE_ENV=production
ENV AILAODA_BLOCK_DEMO_CREDENTIALS=true
ENV SERVE_FRONTEND=true
ENV PORT=5001
ENV FRONTEND_DIST_DIR=/app/dist
ENV DATABASE_URL=file:/data/stable.db
ENV BACKUP_DIR=/data/backups
ENV LOG_DIR=/data/logs
ENV UPLOAD_DIR=/data/uploads
ENV BACKUP_RETENTION_DAYS=90
ENV BACKUP_MAX_FILES=800
ENV BACKUP_MAX_TOTAL_MB=8192

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
COPY --chown=node:node backend/package.json backend/package-lock.json ./backend/
COPY --chown=node:node backend/packages ./backend/packages

RUN cd backend && npm ci --omit=dev && npx prisma generate --schema=prisma/schema.prisma
RUN mkdir -p /data/backups /data/logs /data/uploads \
  && chown -R node:node /app /data

VOLUME ["/data"]
EXPOSE 5001

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/server.js"]
