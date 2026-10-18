#!/usr/bin/env bash
# Cut the Mumbai map file out of the latest Protomaps planet build.
# Only the tiles inside the bounding box are downloaded (HTTP range requests).
#
# Usage: scripts/pmtiles/build.sh [output-file]
# Needs: go-pmtiles (`go install github.com/protomaps/go-pmtiles@latest`), curl.
set -euo pipefail

OUT="${1:-mumbai.pmtiles}"

# Greater Mumbai, Thane and Navi Mumbai (west,south,east,north).
BBOX="${BBOX:-72.75,18.85,73.15,19.35}"
MAXZOOM="${MAXZOOM:-15}"

PMTILES="${PMTILES:-$(command -v pmtiles || command -v go-pmtiles || true)}"
if [[ -z "$PMTILES" ]]; then
  echo "pmtiles CLI not found; run: go install github.com/protomaps/go-pmtiles@latest" >&2
  exit 1
fi

# Daily builds are named YYYYMMDD.pmtiles; walk back to the newest one that exists.
SOURCE="${SOURCE:-}"
if [[ -z "$SOURCE" ]]; then
  for i in $(seq 0 14); do
    day=$(date -u -d "-$i day" +%Y%m%d 2>/dev/null || date -u -v-"$i"d +%Y%m%d)
    url="https://build.protomaps.com/$day.pmtiles"
    if curl -sfI -o /dev/null "$url"; then SOURCE="$url"; break; fi
  done
fi
if [[ -z "$SOURCE" ]]; then
  echo "No Protomaps build found in the last 15 days" >&2
  exit 1
fi

echo "Extracting $BBOX (z0-$MAXZOOM) from $SOURCE"
"$PMTILES" extract "$SOURCE" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"
"$PMTILES" show "$OUT"
ls -lh "$OUT"
