# Multi-stage build for Madrona frontend
# Stage 1: Build
FROM node:24-alpine as builder

WORKDIR /app

# Enable corepack for pnpm support.
# Pin pnpm@10 (matches e2e-tests, frontend-tests, deploy-{staging,production}).
# Do NOT use @latest: pnpm 11 stopped reading "pnpm.overrides" from package.json
# (moved to pnpm-workspace.yaml), so it sees zero overrides and fails the frozen
# install against this lockfile (lockfileVersion 9.0) with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Frontend configuration, all of it build-time.
#
# Vite inlines VITE_* into the bundle when it compiles, and .dockerignore keeps
# .env out of the image, so a build arg is the ONLY way a value reaches the
# built assets. Every name below must also appear under the frontend service's
# build.args in docker-compose.yml, or setting it in .env does nothing at all
# and does so silently — which is exactly how VITE_API_BASE_URL and
# VITE_CARTO_API_KEY came to be documented knobs that were wired to nothing.
# Changing any of them needs this image rebuilt, not just restarted.
#
# Leaving every one empty is the supported case: the app ships working defaults
# throughout.
#
# Build args land in image history. That is acceptable for what these are —
# a same-origin API path, basemap style URLs, a CARTO key that travels in every
# tile request the browser makes, and a Sentry DSN that is a write-only ingest
# address shipped in the client bundle by design. All of them are public by
# construction. Do not extend this pattern to a secret.
ARG VITE_API_BASE_URL
ARG VITE_MAP_STYLE_LIGHT
ARG VITE_MAP_STYLE_DARK
ARG VITE_MAP_STYLE_STANDARD
ARG VITE_CARTO_API_KEY
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_SENTRY_ALLOW_DEV
ARG VITE_TUS_ENDPOINT
ARG VITE_GUIDE_WIDGET_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_MAP_STYLE_LIGHT=$VITE_MAP_STYLE_LIGHT \
    VITE_MAP_STYLE_DARK=$VITE_MAP_STYLE_DARK \
    VITE_MAP_STYLE_STANDARD=$VITE_MAP_STYLE_STANDARD \
    VITE_CARTO_API_KEY=$VITE_CARTO_API_KEY \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT \
    VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE \
    VITE_SENTRY_ALLOW_DEV=$VITE_SENTRY_ALLOW_DEV \
    VITE_TUS_ENDPOINT=$VITE_TUS_ENDPOINT \
    VITE_GUIDE_WIDGET_URL=$VITE_GUIDE_WIDGET_URL

# Build production bundle (increase heap for large bundle)
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN pnpm run build

# Stage 2: Production with nginx
FROM nginx:alpine

# Patch OS-level vulnerabilities. APK_REFRESH_DATE is a build-arg passed by
# CI as the current date so this layer's cache key rotates daily — without
# it, Docker reuses a stale `apk upgrade` layer when alpine has since pushed
# CVE fixes (which is exactly how CVE-2026-27135 evaded scanning).
ARG APK_REFRESH_DATE=unset
RUN echo "apk refresh: $APK_REFRESH_DATE" \
    && apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*

# Copy custom nginx config as a template. The nginx image's entrypoint runs
# envsubst over /etc/nginx/templates/*.template into /etc/nginx/conf.d/.
# NGINX_ENVSUBST_FILTER restricts substitution to MADRONA_* names — without
# it envsubst would also eat nginx's own $host, $uri and $request_uri.
COPY nginx.conf /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=MADRONA_

# Defaults for the same-origin object-store proxy. Every variable the
# template references must be defined or envsubst emits an empty string and
# nginx fails to parse the config, so these are set here rather than relied
# on from compose. Override per deployment.
# MADRONA_TRUSTED_PROXIES is deliberately empty: with no trusted proxy,
# $remote_addr is the immediate peer and a forged X-Forwarded-For cannot
# influence it. Set it to the load balancer's subnet (the whole directive,
# e.g. "set_real_ip_from 10.0.0.0/16;") only when one is actually in front.
ENV MADRONA_TRUSTED_PROXIES="" \
    MADRONA_MEDIA_BUCKET=madrona-media \
    MADRONA_PLATFORM_BUCKET=madrona-platform \
    MADRONA_S3_UPSTREAM=http://seaweedfs:8333 \
    MADRONA_RESOLVER=127.0.0.11

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
