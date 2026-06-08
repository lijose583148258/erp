# Backend-only image for API diagnostics.
# The full ERP+CRM deployable image is the repository-root Dockerfile.
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./

RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5001
ENV SERVE_FRONTEND=false
ENV DATABASE_URL=file:/data/stable.db
ENV BACKUP_DIR=/data/backups
ENV LOG_DIR=/data/logs
ENV UPLOAD_DIR=/data/uploads
ENV BACKUP_RETENTION_DAYS=90
ENV BACKUP_MAX_FILES=800
ENV BACKUP_MAX_TOTAL_MB=8192

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /data/backups /data/logs /data/uploads

VOLUME ["/data"]
EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
