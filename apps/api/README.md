# @map-diary/api

Hono API Worker on `map.snehilsinha.com`. Every route is under `/api`, so the web app can later serve the rest of the hostname from the same origin.

| Resource | Name | Binding |
| --- | --- | --- |
| Worker | `map-diary-api` (custom domain `map.snehilsinha.com`, workers.dev off) | |
| D1 | `map-diary` (`4362f68c-cca6-412f-a8fa-455e4d0db8d1`, APAC) | `DB` |
| R2 | `map-diary-tiles`, object `mumbai.pmtiles` (not created yet: R2 must be enabled on the account) | `TILES` |
| Cron | `17 * * * *`, expires stale resolver jobs | |

```sh
pnpm --filter @map-diary/api test               # Vitest in workerd, migrations applied to a local D1
pnpm --filter @map-diary/api dev                # wrangler dev
pnpm --filter @map-diary/api db:migrate:remote  # apply new migrations in migrations/
pnpm --filter @map-diary/api deploy
```

Schema changes go in a new numbered file under `migrations/`, never ad-hoc SQL. Run `pnpm cf-typegen` after changing `wrangler.jsonc`.

`wrangler deploy` will fail until the `map-diary-tiles` bucket exists. The first deploy was uploaded without the `TILES` binding for that reason.
