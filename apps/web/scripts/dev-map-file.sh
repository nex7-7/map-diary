#!/usr/bin/env bash
# Copy a local Mumbai map file to public/dev/ for `next dev` (not committed).
# Usage: scripts/dev-map-file.sh [path/to/mumbai.pmtiles]
set -euo pipefail
SRC="${1:-/mnt/project-files/map/mumbai.pmtiles}"
cd "$(dirname "$0")/.."
mkdir -p public/dev
cp "$SRC" public/dev/mumbai.pmtiles
ls -lh public/dev/mumbai.pmtiles
