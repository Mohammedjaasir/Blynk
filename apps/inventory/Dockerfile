# Blynk inventory (web) - production image for Coolify or any Docker host.
#
# Build:  docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 .
# The API address is baked in at build time (Vite), so it is a build
# argument, not a runtime variable. vite.config.ts refuses a production
# build when it is missing, localhost or plain http.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL build argument is required" && exit 1)
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
