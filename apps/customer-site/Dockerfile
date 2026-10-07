# Blynk customer website: the landing page (/) + the installable shop (/app/).
#
# Coolify: Build Pack "Dockerfile", Base Directory "/", Dockerfile Location
# "/apps/customer-site/Dockerfile", port 80. Build arguments:
#   API_BASE_URL     the Blynk API, e.g. https://api.example.com/api/v1 (required)
#   SHARE_BASE_URL   this site's https address, used in shared product links (optional)
#   ANDROID_CERT_SHA256  the APK's signing-key SHA-256, if not this PC's debug key (optional)
#   ANDROID_APK_URL  where "Download for Android" points (default /download/blynk.apk)
#
# APKs: https://<site>/download/<name>.apk serves a file from a volume mounted
# at /usr/share/nginx/html/download if there is one, else the copy built in
# from apps/customer-site/files/ (blynk.apk, rider.apk, ops.apk).

# ---- 1. The shop: the Flutter customer app, built for the web --------------
FROM ghcr.io/cirruslabs/flutter:stable AS app
WORKDIR /src
COPY apps/customer/blinkit-clone-Flutter-ecommerce-/ ./
ARG API_BASE_URL
# This site's own address (https://...), for the links the app shares. Optional.
ARG SHARE_BASE_URL=
RUN test -n "$API_BASE_URL" || (echo "API_BASE_URL build argument is required" && exit 1)
# The bundled .env is for local development only; the build-time value wins.
RUN rm -f .env && touch .env \
 && flutter pub get \
 && flutter build web --release --base-href /app/ --dart-define=API_BASE_URL="$API_BASE_URL" --dart-define=SHARE_BASE_URL="$SHARE_BASE_URL"

# ---- 2. The website ---------------------------------------------------------
FROM nginx:1.27-alpine
COPY apps/customer-site/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/customer-site/index.html apps/customer-site/styles.css apps/customer-site/app.js \
     apps/customer-site/manifest.webmanifest /usr/share/nginx/html/
COPY apps/customer-site/assets /usr/share/nginx/html/assets
COPY apps/customer-site/files /usr/share/nginx/html/files
# Android App Links. The fingerprint is the key the Blynk APK is signed with;
# a build signed with another key needs ANDROID_CERT_SHA256 set to its SHA-256.
COPY apps/customer-site/.well-known /usr/share/nginx/html/.well-known
ARG ANDROID_CERT_SHA256=
RUN if [ -n "$ANDROID_CERT_SHA256" ]; then sed -i "s#\"sha256_cert_fingerprints\": \[[^]]*\]#\"sha256_cert_fingerprints\": [\"${ANDROID_CERT_SHA256}\"]#" /usr/share/nginx/html/.well-known/assetlinks.json; fi
COPY --from=app /src/build/web /usr/share/nginx/html/app
ARG ANDROID_APK_URL=/download/blynk.apk
RUN sed -i "s#/download/blynk.apk#${ANDROID_APK_URL}#" /usr/share/nginx/html/index.html \
 && mkdir -p /usr/share/nginx/html/download
EXPOSE 80
