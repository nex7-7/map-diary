# Mumbai Places Diary

A private, end-to-end encrypted map diary of Mumbai places, shared with two small friend groups.
The full design is in @docs/architecture.md — read it before planning or changing anything.

## Non-negotiables

- **The server is blind.** The Worker and D1 never see plaintext opinions, place catalogue entries or keys. Encrypt on the client; the server stores envelopes (ciphertext + metadata) only.
- **No custom crypto.** Use libsodium (libsodium-wrappers) primitives only. No hand-written ciphers, KDFs or signature schemes.
- **Location stays on the device.** Never send GPS coordinates of the user to any server or API.
- **Zero cost.** Cloudflare free tier only (Workers, D1, R2, cron). No paid APIs, no Google Maps/Places API, no Supabase/Firebase.
- **Claude assistant scope:** master board + the owner's personal board. It never holds group keys.
- **No moderation.** No code path lets anyone (including admin) hide or delete another person's opinion.

## Data model in one paragraph

Places hold shared facts (written once; only admin edits). People attach opinions (status, tag definition, tag, comment). Each opinion is encrypted once with a random content key, wrapped once per chosen board. Boards: master (everyone, master key), each group (group key), personal (personal key). Default board for new opinions: personal. A place is on a person's list only with a status opinion (Visited / Want to). A board shows only opinions from its own members. Leaving a group deletes that person's opinions on its board and rotates the group key. Every item has one author, so sync is last-write-wins per envelope.

## Stack

- Next.js + React + TypeScript (strict), deployed to Cloudflare Workers.
- Separate API Worker (Hono) at `map.snehilsinha.com`: sync, invites, key backups, MCP server, resolver queue.
- D1 for envelopes, wrapped keys, devices. R2 for the Mumbai PMTiles map file.
- MapLibre GL + PMTiles. IndexedDB on device.
- Android: Capacitor shell + custom Kotlin geofencing plugin (CMF Phone 1, Nothing OS).
- Domain DNS is already on Cloudflare.

## Conventions

- TypeScript strict mode; no `any` in crypto, sync or envelope code.
- Crypto and envelope logic live in one package/module with unit tests; UI code never calls libsodium directly.
- D1 schema changes go through Wrangler migrations, never ad-hoc SQL.
- Never log decrypted content, keys or passphrases, on client or server.
- Use the Cloudflare docs MCP / skills for current Workers, D1 and R2 APIs rather than memory.

## Current phase

Phase 5 — Sharing: master key and master board (place catalogue moves there), groups and group invites, tagging and commenting on others' places, member removal with key rotation. Phases 1–3 are live; Phase 4 (accounts and devices) is live except admin app invites, which are being finished.
