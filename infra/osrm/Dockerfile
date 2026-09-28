# Blynk routing: a self-hosted OSRM (Open Source Routing Machine) for Sri
# Lanka. Deployed on Coolify as its own application (base directory
# /infra/osrm, port 5000). The Blynk API calls it on Coolify's internal
# network (OSRM_URL); it does not need a public domain.
#
# The road network is OpenStreetMap data (c) OpenStreetMap contributors, from
# Geofabrik's daily Sri Lanka extract. Rebuild (Redeploy) to refresh roads.
#
# Build needs about 2 GB of memory for the Sri Lanka extract; the running
# service needs a few hundred MB.

FROM alpine:3.20 AS download
ARG OSM_PBF_URL=https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf
RUN apk add --no-cache wget \
 && mkdir -p /data \
 && wget -q -O /data/region.osm.pbf "$OSM_PBF_URL"

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS build
COPY --from=download /data/region.osm.pbf /data/region.osm.pbf
# Car profile: roads a motorbike rider can use (no footpaths or steps).
RUN osrm-extract -p /opt/car.lua /data/region.osm.pbf \
 && osrm-partition /data/region.osrm \
 && osrm-customize /data/region.osrm \
 && rm /data/region.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=build /data /data
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "--max-table-size", "100", "/data/region.osrm"]
