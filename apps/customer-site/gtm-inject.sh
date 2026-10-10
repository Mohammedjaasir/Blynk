#!/bin/sh
# Google Tag Manager on blynk.lk (owner, 2026-10-10): fills in, or removes,
# the GTM snippet in the landing page and the shop's index.html at build time.
#
#   GTM_ID=GTM-XXXXXXX CONSENT_DEFAULT=granted sh gtm-inject.sh FILE...
#
# GTM_ID          the container ID (GTM-...). Empty: the GTM blocks are deleted
#                 from every FILE, so the site makes no tracking request at all.
# CONSENT_DEFAULT granted (default) or denied: Google Consent Mode v2 default
#                 for ad_storage, ad_user_data, ad_personalization and
#                 analytics_storage. A browser sending Global Privacy Control
#                 or Do Not Track is always denied, whatever this says.
#
# Used by apps/customer-site/Dockerfile; setup guide:
# docs/06-deployment/google-tag-manager-and-ads-setup.md
set -eu

GTM_ID=$(printf '%s' "${GTM_ID:-}" | tr -d '[:space:]')
CONSENT_DEFAULT=$(printf '%s' "${CONSENT_DEFAULT:-granted}" | tr -d '[:space:]')
[ -n "$CONSENT_DEFAULT" ] || CONSENT_DEFAULT=granted

case "$CONSENT_DEFAULT" in
  granted|denied) ;;
  *) echo "gtm-inject: CONSENT_DEFAULT must be granted or denied, not '$CONSENT_DEFAULT'" >&2; exit 1 ;;
esac
if [ -n "$GTM_ID" ] && ! printf '%s' "$GTM_ID" | grep -Eq '^GTM-[A-Z0-9]{4,12}$'; then
  echo "gtm-inject: GTM_ID must look like GTM-XXXXXXX (capital letters and digits), not '$GTM_ID'" >&2
  exit 1
fi
[ "$#" -gt 0 ] || { echo "gtm-inject: no files given" >&2; exit 1; }

for f in "$@"; do
  [ -f "$f" ] || { echo "gtm-inject: $f not found" >&2; exit 1; }
  for marker in GTM-HEAD-START GTM-HEAD-END GTM-BODY-START GTM-BODY-END; do
    grep -q "$marker" "$f" || { echo "gtm-inject: $f has no $marker marker" >&2; exit 1; }
  done
  if [ -z "$GTM_ID" ]; then
    sed -i -e '/GTM-HEAD-START/,/GTM-HEAD-END/d' -e '/GTM-BODY-START/,/GTM-BODY-END/d' "$f"
    if grep -q 'googletagmanager' "$f"; then echo "gtm-inject: GTM still in $f" >&2; exit 1; fi
    echo "gtm-inject: no GTM_ID, tracking removed from $f"
  else
    sed -i -e "s/__GTM_ID__/$GTM_ID/g" -e "s/__CONSENT_DEFAULT__/$CONSENT_DEFAULT/g" "$f"
    if grep -Eq '__GTM_ID__|__CONSENT_DEFAULT__' "$f"; then echo "gtm-inject: placeholders left in $f" >&2; exit 1; fi
    echo "gtm-inject: $GTM_ID ($CONSENT_DEFAULT by default) in $f"
  fi
done
