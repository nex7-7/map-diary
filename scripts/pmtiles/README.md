# Mumbai map file

The app's offline map is one PMTiles file, cut from the [Protomaps](https://protomaps.com) OpenStreetMap basemap build and served from R2. Devices download it once and cache it, so browsing the map never tells anyone which area is being looked at.

| | |
| --- | --- |
| R2 bucket | `map-diary-tiles` (private; no public access) |
| Object key | `mumbai.pmtiles` |
| Worker binding | `TILES` (R2 binding in the API Worker) |
| Area | `72.75,18.85,73.15,19.35`: Greater Mumbai, Thane, Navi Mumbai |
| Zoom | 0–15 (Protomaps basemap layers, rendered by MapLibre) |

## Rebuild and upload

```sh
go install github.com/protomaps/go-pmtiles@latest
scripts/pmtiles/build.sh mumbai.pmtiles
scripts/pmtiles/upload.sh mumbai.pmtiles
```

`build.sh` uses range requests, so it downloads only the Mumbai tiles, not the planet. Override `BBOX`, `MAXZOOM` or `SOURCE` with environment variables. `upload.sh` needs wrangler signed in to the Cloudflare account. The `.pmtiles` file itself is not committed.

## Create the bucket

```sh
npx wrangler r2 bucket create map-diary-tiles
```

R2 must first be enabled once in the Cloudflare dashboard (R2 Object Storage → enable). The free tier covers 10 GB of storage, which this file uses a tiny fraction of.
