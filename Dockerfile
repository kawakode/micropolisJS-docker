# KawaCity: build the static site, then serve it with nginx.
#
#   docker build -t kawacity .
#   docker run --rm -p 8080:80 kawacity
#
# then open http://localhost:8080

# The site is static, so it is built once, natively, whatever the platforms of the image (see the workflow in
# .github/workflows, which publishes it for amd64 and arm64)
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# The build id shown in the game normally comes from git, which is not available inside the build context
ARG BUILD_ID=docker
ENV BUILD_ID=${BUILD_ID}

RUN npm run build


FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
