# Blynk seller portal (web) - production image for Coolify or any Docker host
# (served at https://blynk-seller.valgrowlabs.com).
#
# Build:  docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 .
# The API address is baked in at build time (Vite), so it is a build
# argument, not a runtime variable.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL build argument is required" && exit 1)
RUN npm run build
# The installable app's files (public/) must be in the build: the manifest, the
# icons and the push service worker, all served from the site root.
RUN test -f dist/manifest.webmanifest \
    && test -f dist/firebase-messaging-sw.js \
    && test -f dist/icons/icon-192.png \
    && test -f dist/icons/icon-512.png \
    && test -f dist/icons/icon-maskable-512.png

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
