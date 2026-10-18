# Map assets

Served with the app so the map needs no third-party requests.

- `fonts/`: glyph ranges for the Protomaps basemap labels (Noto Sans, SIL Open Font License 1.1), copied from [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets). Latin, Latin Extended, Devanagari and punctuation ranges only.
- `sprites/`: Protomaps basemap v4 icon sprites (light and dark), from the same repository.
- `maplibre/`: MapLibre's worker, copied from `node_modules` by `scripts/copy-maplibre-worker.mjs` on `dev` and `build`. Not committed.

The map file itself (`mumbai.pmtiles`) is not here: the app downloads it once from the API Worker and keeps it in Cache Storage.
