FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOME=/data \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN npm install -g 9router@0.5.45 --omit=dev \
    && mkdir -p /data \
    && chown -R node:node /data

USER node
WORKDIR /data

EXPOSE 20128
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:20128/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["9router", "--host", "0.0.0.0", "--port", "20128", "--no-browser", "--skip-update", "--log"]
