FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY apps/desktop/package.json ./apps/desktop/

RUN npm ci

COPY packages/engine ./packages/engine
COPY apps/server ./apps/server
COPY apps/web ./apps/web
COPY apps/desktop/package.json ./apps/desktop/package.json

RUN npm run build \
  && mkdir -p /data

ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/data

EXPOSE 8787

CMD ["node", "apps/server/dist/index.js"]
