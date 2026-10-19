# @map-diary/api

Hono API Worker on `map.snehilsinha.com/api/*`. The web app Worker (`map-diary-web`) is the Custom Domain for the rest of the hostname, so both share one origin.

| Resource | Name | Binding |
| --- | --- | --- |
| Worker | `map-diary-api` (route `map.snehilsinha.com/api/*`, workers.dev off; the web app owns the hostname as a Custom Domain) | |
| D1 | `map-diary` (`4362f68c-cca6-412f-a8fa-455e4d0db8d1`, APAC) | `DB` |
| R2 | `map-diary-tiles`, object `mumbai.pmtiles` | `TILES` |
| Cron | `17 * * * *`, expires stale resolver jobs, device pairings and unused app invites | |
| Secret | `RESOLVER_TOKEN`, the resolver's bearer token (see docs/resolver.md) | `RESOLVER_TOKEN` |

## Routes

Signed routes need the `X-Device-Id`, `X-Timestamp` and `X-Signature` headers from `signRequest()` in `@map-diary/crypto`: an Ed25519 signature by the device over the method, path and query, timestamp and a hash of the body. There are no sessions or passwords. Timestamps more than 5 minutes off are refused.

| Route | Auth | Does |
| --- | --- | --- |
| `GET /api/health` | none | Health and applied migration count |
| `POST /api/accounts` | the new device | Creates an account with its box public key, first device, personal board and its key, and optional key backup. Without an invite: first-run admin setup, open only while no account exists, backup required. With `invite`: uses up an unused, unexpired app invite and joins the master board with every master key version (`masterKeys`, re-wrapped to the new account) |
| `POST /api/devices` | the new device, authorised by the account key | Signs a new device in |
| `GET /api/me` | device | The account (box public key, whether a passphrase backup exists), its boards with their keys wrapped to the account, and its devices |
| `POST /api/app-invites` | admin device | Files a one-time, seven-day app invite under an id derived from the invite code, with every master key version wrapped to a keypair derived from the code (at most 10 open) |
| `GET /api/app-invites` | admin device | Open invites |
| `DELETE /api/app-invites/:id` | admin device | Cancels an unused invite |
| `GET /api/app-invites/:id/status` | none, needs the id from the code | Open, used or expired; while open, the master board id and the invite's wrapped master keys |
| `GET /api/members` | admin device | Every account with its invite id, active device count and last use; no names |
| `POST /api/members/:id/remove` | admin device | Removes someone from the app: marks the account removed, revokes all its devices, and in the same step moves the master board to the next key, sent as `masterKeyVersion` and `masterKeys` (one wrap per member who stays) |
| `PUT /api/board-keys` | device | Stores board keys wrapped to the account's box key |
| `POST /api/boards/master` | the admin's device | Creates the master board once, with its first key wrapped to the admin's account |
| `GET /api/boards/:id/members` | device of a member | The board's members and their current account box public keys, for wrapping a rotated key |
| `POST /api/place-links/check` | device of a master board member | Which of up to 50 keyed link hashes already belong to a catalogue place |
| `POST /api/devices/:id/revoke` | another device of the same account | Revokes the device and, in the same step, moves the account to the next box key version: the new public key, every board key re-wrapped to it, the next Personal board key, a fresh key for every shared board (master, later groups) wrapped to every member, and the new account key sealed to each remaining device |
| `GET /api/me/account-key` | device | The current account box key sealed to this device, after another device revoked one |
| `POST /api/pairings` | device | Opens a ten-minute device pairing under an id derived from the link secret |
| `GET /api/pairings/:id` | device of the same account | The joining device's public keys and MAC, once it has joined |
| `POST /api/pairings/:id/approve` | device of the same account | Registers the joining device (authorised by the approving device's key) and stores the account keys sealed to it |
| `DELETE /api/pairings/:id` | device of the same account | Cancels a pairing |
| `POST /api/pairings/:id/join` | none, needs the id from the link | The new device offers its public keys and a MAC under the link secret |
| `GET /api/pairings/:id/status` | none, needs the id from the link | Waiting, joined or approved |
| `GET /api/pairings/:id/transfer` | the new device, once approved | The sealed account keys; deletes the pairing |
| `POST /api/key-backup/fetch` | none, needs the passphrase-derived lookup id | Returns the passphrase key backup |
| `PUT /api/key-backup` | device | Replaces the key backup |
| `POST /api/envelopes` | device | Pushes up to 100 envelopes; last write wins per envelope on `updatedAt`; one sealed with a board key version a revocation replaced is refused as `stale_key` for the device to re-seal. Catalogue rules: a `place` goes to the master board alone (`place_not_on_master`), a `private_place` never does (`private_on_master`), only the admin changes a `place` after its first write (`facts_locked`), and a new `place` whose link hash (sent beside it as `linkHashes`) another place holds is refused as `duplicate_place` with that place's id |
| `POST /api/envelopes/delete` | device | Tombstones the account's own envelopes; only the admin deletes a catalogue `place` |
| `GET /api/sync?since=&limit=` | device | Changes on the account's boards after a cursor, with signer keys, the account's box key version and its boards' current key versions |
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
