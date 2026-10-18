#!/usr/bin/env bash
# Upload the Mumbai map file to R2.
#
# Usage: scripts/pmtiles/upload.sh [file]
# Needs: wrangler signed in (`npx wrangler login`) or CLOUDFLARE_API_TOKEN set.
set -euo pipefail

FILE="${1:-mumbai.pmtiles}"
BUCKET="${BUCKET:-map-diary-tiles}"
KEY="${KEY:-mumbai.pmtiles}"

npx --yes wrangler@4 r2 object put "$BUCKET/$KEY" \
  --file "$FILE" \
  --content-type application/vnd.pmtiles \
  --cache-control "public, max-age=86400" \
  --remote
