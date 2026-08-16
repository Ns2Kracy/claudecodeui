FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOME=/data \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

COPY allow-private-provider-urls.js /tmp/allow-private-provider-urls.js

RUN npm install -g 9router@0.5.50 --omit=dev \
    && node /tmp/allow-private-provider-urls.js \
    && rm /tmp/allow-private-provider-urls.js \
    && mkdir -p /data \
    && chown -R node:node /data

USER node
WORKDIR /data

EXPOSE 20128
VOLUME ["/data"]

CMD ["9router", "--host", "0.0.0.0", "--port", "20128", "--no-browser", "--skip-update", "--log"]
