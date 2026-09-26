# Porchlight city app, for Vultr or any Docker host.
#
# The build and the prune happen in one RUN step, so the source tree and build tools never
# reach the final image layers. Only the Next.js standalone server is kept.

FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

COPY . /src
RUN cd /src \
 && npm ci \
 && npm run city:build \
 && mkdir -p /app /data \
 && cp -r apps/city/.next/standalone/. /app/ \
 && cd / \
 && rm -rf /src /root/.npm /tmp/* \
 && chown -R node:node /app /data

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CITY_DATA_DIR=/data

USER node
EXPOSE 3000
CMD ["node", "apps/city/server.js"]
