# One container: API + built web app. Data (SQLite + photos) lives in /data — mount a volume there.
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATABASE_FILE=/data/fieldproof.db UPLOAD_DIR=/data/uploads WEB_DIST=/app/web/dist TRUST_PROXY=true
WORKDIR /app/server
COPY server/package*.json server/.npmrc ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
