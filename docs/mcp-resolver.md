# Claude resolver (MCP)

Phase 3. Claude works the [resolver queue](resolver.md) through a custom connector and a
scheduled task. Claude only ever sees a pasted link or place name, never who asked,
anyone's opinions or any keys.

The code is `apps/api/src/mcp.ts`. It runs the same `takePendingJobs` and
`submitResolution` as the REST resolver routes, so the same checks apply.

## Endpoint

Streamable HTTP MCP, stateless: every `POST` is one JSON-RPC message (or a batch) and gets
a plain JSON reply. `GET` and `DELETE` answer `405`.

| URL | Auth |
| --- | --- |
| `https://map.snehilsinha.com/api/mcp/<RESOLVER_TOKEN>` | token in the path, for claude.ai connectors (they take a URL, not headers) |
| `https://map.snehilsinha.com/api/mcp` | `Authorization: Bearer <RESOLVER_TOKEN>`, for clients that can send headers |

| Tool | Input | Output |
| --- | --- | --- |
| `get_pending_jobs` | `{ limit?: 1-50 }` (default 10) | `{ jobs: [{ id, query, expandedUrl?, attempts, createdAt }] }`. Each listing counts an attempt; 5 without an answer fails the job |
| `submit_resolution` | `{ jobId, candidates: ResolvedPlace[] }` or `{ jobId, failed: true }` | `{ jobId, status }`, or an error in plain words (outside Mumbai, bad price, already answered…) that Claude can fix and retry |

`ResolvedPlace` is the format in [resolver.md](resolver.md#result-format).

The token in the path is visible to anything that logs full URLs, including this Worker's
own Cloudflare logs. Only the resolver queue sits behind it, so the worst case is someone
answering or failing pending jobs. If it leaks, set a new token and update the connector.

## Setup (Snehil)

1. **Set the token** (once; skip if `RESOLVER_TOKEN` is already set to a hex value). Use hex
   so it is safe in a URL, and keep a copy for step 3:

   ```sh
   openssl rand -hex 32 > resolver-token.txt
   pnpm --filter @map-diary/api exec wrangler secret put RESOLVER_TOKEN < resolver-token.txt
   ```

2. **Deploy** the API Worker (`CI=1 pnpm run deploy` in `apps/api`).
3. **Add the connector** in Claude: Settings → Connectors → Add custom connector.
   - Name: `Map diary resolver`
   - URL: `https://map.snehilsinha.com/api/mcp/` followed by the token
   - Leave the OAuth fields under Advanced settings empty.
   Then delete `resolver-token.txt`.
4. **Try it** in a chat with the connector on: "List pending map diary jobs." An empty list
   means it works.
5. **Schedule it** as a scheduled task (or a routine) with the prompt below, every 6 hours,
   with only this connector enabled. If scheduled tasks are not on the Pro plan, paste the
   prompt into a chat whenever the Inbox shows pending places.

## Scheduled task prompt

```text
You resolve places for my private Mumbai map diary, using the "Map diary resolver"
connector. Use no other connector, and do not save anything about these places to memory.

1. Call get_pending_jobs with limit 10. If there are no jobs, stop and say "No pending jobs."
2. For each job, find the place its query describes. The query is a Google Maps, Zomato,
   District or other link, or a plain name. If expandedUrl is present, it is the full Google
   Maps URL behind a short link; its coordinates and name are the best evidence. Search
   the web for anything else. A plain name means a place in Mumbai.
3. Answer each job with submit_resolution, one call per job:
   - candidates: 1 to 5 places. Give one when you are sure. Give up to 5 when a name
     matches several places (for example branches of a chain); I pick one later.
   - name: as the place writes it.
   - category: restaurant, cafe-bar, movies, recreation or beach. Bars, pubs, cafés,
     bakeries and dessert shops are cafe-bar.
   - location: lat and lng of the place itself, from Google Maps or the expanded URL.
     They must be inside Mumbai (lat 18.85 to 19.35, lng 72.75 to 73.15).
   - address: short, area and city.
   - cuisine: for food and drink only, e.g. "Parsi" or "South Indian".
   - signatureDish: restaurant and cafe-bar only. The dish the place is best known for,
     with its current menu price for one serving, in whole rupees (no ranges, no "for
     two" prices). Prefer the menu on Zomato, Swiggy, District or the place's own site.
     Leave it out if you cannot find a real price.
   - sourceLinks: the https pages you used, at most 5.
   - If you cannot find the place, or it is outside Mumbai, call submit_resolution with
     failed: true instead.
4. Never invent a fact. Leave out any optional field you could not check.
5. If submit_resolution returns an error, fix what it names and try once more; if it says
   the job no longer exists or was already answered, move on.
6. End with one line per job: the query, then "resolved", "resolved with N choices" or
   "failed".
```

## Testing by hand

```sh
TOKEN=...  # the RESOLVER_TOKEN
curl -s https://map.snehilsinha.com/api/mcp/$TOKEN -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_pending_jobs","arguments":{}}}'
```
