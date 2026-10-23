# Web app

Next.js app, client-rendered: decryption and everything the map shows happen in the browser.

## Build and hosting

`pnpm build` makes a static export in `out/`: one HTML file per page, no server code. `scripts/finish-export.mjs` then writes `out/_headers` (the CSP and security headers from `security-headers.mjs`, which `next dev` also sends) and removes `out/dev`. `wrangler deploy` uploads `out/` as a Worker with static assets only, so page requests never run Worker code or count against its CPU limit. Pages take their parameters from the query string (`/place?id=…`), since a static export has no dynamic routes.

## Map and list

- `/` shows the map and list over this device's decrypted items (`createItemsSource` in `lib/places/items-source.ts`) once it is signed in. `/sample` shows the same views over sample data (`lib/places/fixtures.ts`); it and `/sample/ui` are `page.dev.tsx` files, so they exist only under `next dev`.
- Filtering, sorting and distance live in `lib/places/filter.ts` (tested in `test/places.test.ts`). Near me asks for the position only on tap and keeps it in memory; it is never sent anywhere.
- The Mumbai map file is downloaded whole, once, into Cache Storage (`lib/map/map-file.ts`), and MapLibre reads tiles from that local copy, so the server never learns which area is on screen.

## Places without a pin (Phase 3)

- The Add sheet saves a name, a Zomato or District link, or a short Google Maps link without a location. Short Maps links go to `POST /api/resolver/expand` first; if the full URL carries coordinates the place is saved straight away. Everything else becomes an anonymous resolver job (`docs/resolver.md`): only the link or name is sent, with a one-time public key.
- `lib/pending` keeps these on the device, in their own IndexedDB database (`map-diary-pending`), with the job's one-time secret key. They are not synced, so a place waiting on the phone shows in the phone's Inbox only. `PendingQueue.poll` runs every minute while the app is open (every 15 seconds on the Inbox), writes a single match to the diary with the Add sheet's status, tags and note, and keeps several matches for the person to pick from. Tested in `test/pending.test.ts`.
- `/inbox` lists matches to pick, lookups that failed (try again, drop a pin, or remove) and those still waiting.

## Map file in development

`NEXT_PUBLIC_MAP_FILE_URL` says where the map file is downloaded from. Production uses `/api/tiles/mumbai.pmtiles` on the same origin. `.env.development` points at a local copy:

```sh
pnpm --filter @map-diary/web map:dev [path/to/mumbai.pmtiles]   # copies it to public/dev/
pnpm dev
```

To use the live file instead, set `NEXT_PUBLIC_MAP_FILE_URL=https://map.snehilsinha.com/api/tiles/mumbai.pmtiles` in `.env.development.local`.
