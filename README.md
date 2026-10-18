# Mumbai Places Diary

A private, end-to-end encrypted map diary of Mumbai places. Design: [docs/architecture.md](docs/architecture.md). Rules for contributors (and Claude): [CLAUDE.md](CLAUDE.md).

## Layout

| Path | What lives there |
| --- | --- |
| `apps/web` | Next.js + React web app (client-rendered, deployed to Cloudflare Workers via OpenNext) |
| `apps/api` | Hono API Worker on `map.snehilsinha.com`: sync, invites, key backups, MCP, resolver queue; D1 migrations |
| `packages/crypto` | `@map-diary/crypto`: every libsodium call, key handling and envelope seal/open, with unit tests |

The UI never imports libsodium directly; it goes through `@map-diary/crypto`.

## Getting started

Requires Node 22+ and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev         # web app on http://localhost:3000
pnpm test        # all package tests
pnpm typecheck   # strict TypeScript across the workspace
```
