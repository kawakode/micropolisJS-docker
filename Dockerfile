# KawaCity: the game, its accounts and multiplayer, served by one Node.js server on port 8080.
#
#   docker build -t kawacity .
#   docker run --rm -p 8080:8080 -v kawacity-data:/data kawacity
#
# then open http://localhost:8080. Accounts, cities and the database live in /data: keep it on a volume. See
# README.md for PUBLIC_URL, mail and the reverse proxy.

# The Node.js version, the same as .node-version (used by the CI)
ARG NODE_IMAGE=node:22.22-alpine

# The game and the server are built once, natively, whatever the platforms of the image (see the workflow in
# .github/workflows, which publishes it for amd64 and arm64)
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The build id shown in the game normally comes from git, which is not available inside the build context
ARG BUILD_ID=docker
ENV BUILD_ID=${BUILD_ID}

RUN npm run build && mkdir -p /out/data


# The server's dependencies are plain JavaScript (no native code): they are installed natively too
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund


# The image itself runs nothing while it is assembled (no RUN), so the arm64 image needs no emulation
FROM ${NODE_IMAGE}

ARG BUILD_ID=docker
ENV PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public \
    UV_THREADPOOL_SIZE=8 \
    BUILD_ID=${BUILD_ID} \
    NODE_OPTIONS="--disable-warning=ExperimentalWarning --enable-source-maps"

WORKDIR /app

# The application belongs to root and is read-only for the server; only /data is its own
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build/server ./server
COPY --from=build /app/dist ./public
COPY --from=build --chown=1000:1000 /out/data /data

# The image's node user
USER 1000:1000

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT:-8080}/api/health || exit 1

CMD ["node", "server/main.cjs"]
