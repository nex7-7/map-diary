# Web app

Next.js app, client-rendered: decryption and everything the map shows happen in the browser.

## Map and list

- `/` shows the map and list over sample data (`lib/places/fixtures.ts`) through the `DiarySource` interface in `lib/places/types.ts`. The on-device store plugs in by implementing that interface.
- Filtering, sorting and distance live in `lib/places/filter.ts` (tested in `test/places.test.ts`). Near me asks for the position only on tap and keeps it in memory; it is never sent anywhere.
- The Mumbai map file is downloaded whole, once, into Cache Storage (`lib/map/map-file.ts`), and MapLibre reads tiles from that local copy, so the server never learns which area is on screen.

## Map file in development

`NEXT_PUBLIC_MAP_FILE_URL` says where the map file is downloaded from. Production uses `/api/tiles/mumbai.pmtiles` on the same origin. `.env.development` points at a local copy:

```sh
pnpm --filter @map-diary/web map:dev [path/to/mumbai.pmtiles]   # copies it to public/dev/
pnpm dev
```

To use the live file instead, set `NEXT_PUBLIC_MAP_FILE_URL=https://map.snehilsinha.com/api/tiles/mumbai.pmtiles` in `.env.development.local`.
