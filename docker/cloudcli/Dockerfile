FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --include=dev \
    && npm rebuild better-sqlite3 bcrypt node-pty

COPY . .
RUN npm run build

EXPOSE 3001
CMD ["npm", "run", "server"]
