FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/mac-ui-core/package.json packages/mac-ui-core/package.json
COPY packages/sub2-console/package.json packages/sub2-console/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY Dockerfile ./Dockerfile
COPY deploy ./deploy
COPY scripts/release-snapshot.cjs ./scripts/release-snapshot.cjs
COPY LICENSE COPYING NOTICE.md THIRD_PARTY_NOTICES.md THIRD_PARTY_LICENSES.txt ./
RUN pnpm build:release

FROM nginx:1.28-alpine
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/packages/sub2-console/dist /usr/share/nginx/html
COPY --from=build /app/LICENSE /app/COPYING /app/NOTICE.md /app/THIRD_PARTY_NOTICES.md /app/THIRD_PARTY_LICENSES.txt /usr/share/licenses/sub2-mac/
ENV SUB2API_UPSTREAM=http://host.docker.internal:8000
# Only substitute the upstream; preserve nginx runtime variables in the template.
ENV NGINX_ENVSUBST_FILTER=^SUB2API_UPSTREAM$
EXPOSE 80
