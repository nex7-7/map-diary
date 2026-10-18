# @map-diary/api

Hono API Worker on `map.snehilsinha.com/api/*`. The web app Worker (`map-diary-web`) is the Custom Domain for the rest of the hostname, so both share one origin.

| Resource | Name | Binding |
| --- | --- | --- |
| Worker | `map-diary-api` (route `map.snehilsinha.com/api/*`, workers.dev off; the web app owns the hostname as a Custom Domain) | |
| D1 | `map-diary` (`4362f68c-cca6-412f-a8fa-455e4d0db8d1`, APAC) | `DB` |
| R2 | `map-diary-tiles`, object `mumbai.pmtiles` | `TILES` |
| Cron | `17 * * * *`, expires stale resolver jobs | |
| Secret | `RESOLVER_TOKEN`, the resolver's bearer token (see docs/resolver.md) | `RESOLVER_TOKEN` |

## Routes

Signed routes need the `X-Device-Id`, `X-Timestamp` and `X-Signature` headers from `signRequest()` in `@map-diary/crypto`: an Ed25519 signature by the device over the method, path and query, timestamp and a hash of the body. There are no sessions or passwords. Timestamps more than 5 minutes off are refused.

| Route | Auth | Does |
| --- | --- | --- |
| `GET /api/health` | none | Health and applied migration count |
| `POST /api/accounts` | the new device | First-run setup: admin account with its box public key, first device, personal board and its key, key backup. Open only while no account exists |
| `POST /api/devices` | the new device, authorised by the account key | Signs a new device in |
| `GET /api/me` | device | The account and its box public key, its boards with their keys wrapped to the account, and its devices |
| `PUT /api/board-keys` | device | Stores board keys wrapped to the account's box key |
| `POST /api/key-backup/fetch` | none, needs the passphrase-derived lookup id | Returns the passphrase key backup |
| `PUT /api/key-backup` | device | Replaces the key backup |
| `POST /api/envelopes` | device | Pushes up to 100 envelopes; last write wins per envelope on `updatedAt` |
| `POST /api/envelopes/delete` | device | Tombstones the account's own envelopes |
| `GET /api/sync?since=&limit=` | device | Changes on the account's boards after a cursor, with signer keys |
| `GET/HEAD /api/tiles/mumbai.pmtiles` | none | The map file, with Range and ETag. Devices download it whole and read it locally |
| `POST /api/resolver/jobs` | none (anonymous) | Queues a name or link with a one-time reply key |
| `GET/DELETE /api/resolver/jobs/:id` | none, the job id | Polls a job for its sealed result, or deletes it |
| `POST /api/resolver/expand` | none | Expands a short Google Maps link to the full URL |
| `GET /api/resolver/pending` | `RESOLVER_TOKEN` | The resolver's list of pending jobs |
| `POST /api/resolver/jobs/:id/resolution` | `RESOLVER_TOKEN` | The resolver's answer, checked and sealed to the job's key |
| `POST /api/mcp/:token`, `POST /api/mcp` | `RESOLVER_TOKEN` in the path, or as a Bearer header | MCP server for the resolver: `get_pending_jobs` and `submit_resolution` (see docs/mcp-resolver.md) |

libsodium cannot compile its embedded WebAssembly inside workerd, so `pnpm run sodium-wasm` (run automatically before dev, test, typecheck, build and deploy) extracts the binary from the installed libsodium into `src/generated/`, and `src/sodium-wasm.ts` hands it over as a precompiled module.

```sh
pnpm --filter @map-diary/api test               # Vitest in workerd, migrations applied to a local D1
pnpm --filter @map-diary/api smoke              # wrangler dev + real requests; catches workerd-only failures
pnpm --filter @map-diary/api dev                # wrangler dev
pnpm --filter @map-diary/api db:migrate:remote  # apply new migrations in migrations/
pnpm --filter @map-diary/api deploy
```

Schema changes go in a new numbered file under `migrations/`, never ad-hoc SQL. Run `pnpm cf-typegen` after changing `wrangler.jsonc`.
