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
| `https://map.snehilsinha.com/api/mcp` | `Authorization: Bearer <RESOLVER_TOKEN>` (the token is never accepted in the URL) |

| Tool | Input | Output |
| --- | --- | --- |
| `get_pending_jobs` | `{ limit?: 1-50 }` (default 10) | `{ jobs: [{ id, query, expandedUrl?, attempts, createdAt }] }`. Each listing counts an attempt; 5 without an answer fails the job |
| `submit_resolution` | `{ jobId, candidates: ResolvedPlace[] }` or `{ jobId, failed: true }` | `{ jobId, status }`, or an error in plain words (outside Mumbai, bad price, already answered…) that Claude can fix and retry |

`ResolvedPlace` is the format in [resolver.md](resolver.md#result-format).

The token goes only in a header, so it stays out of anything that logs full URLs. Only the
resolver queue sits behind it, so the worst case is someone answering or failing pending
jobs. If it leaks, set a new token and update the connector.

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
   - URL: `https://map.snehilsinha.com/api/mcp`
   - Sign-in: No sign-in. Under Request headers, add `Authorization` with the value
     `Bearer ` followed by the token (note the space).
   Then delete `resolver-token.txt`.
4. **Try it** in a chat with the connector on: "List pending map diary jobs." An empty list
   means it works.
5. **Schedule it** as a scheduled task (or a routine) with the prompt below, every 6 hours,
   with only this connector enabled. If scheduled tasks are not on the Pro plan, paste the
   prompt into a chat whenever the Inbox shows pending places.

### Two connectors, not one

The resolver connector and the Claude assistant connector (Devices → Connect Claude) are
separate connectors with different URLs and secrets. Add the assistant as a new connector
named `Map diary`; don't edit this one. If the "Map diary resolver" connector lists tools
like Search places or Add a place instead of `get_pending_jobs` and `submit_resolution`, its
URL was changed to `/api/claude/mcp`: rename it to `Map diary`, and add the resolver again
as in step 3.

## Scheduled task prompt

```text
You resolve places for my private Mumbai map diary, using the "Map diary resolver"
connector. Use no other connector, and do not save anything about these places to memory.

1. Call get_pending_jobs with limit 10. If there are no jobs, stop and say "No pending jobs."
2. For each job, find the place its query describes. The query is a Google Maps, Zomato,
   District or other link, or a plain name. If expandedUrl is present, it is the full Google
   Maps URL behind a short link; its coordinates and name are the best evidence. Search
   the web for anything else. A plain name means a place in Mumbai.
3. Check whether the place is one outlet of a chain. On its Zomato page, scroll down to the
   Direction box: a link such as "See all 3 The Bombay Cartel outlets in Mumbai" means it is.
   Open that link and note every outlet listed (name, area and address, and its own Zomato
   link). For a place that is not on Zomato, use Google Maps or the place's own site to find
   its other Mumbai outlets. Ignore "See all N outlets in <mall or compound>": that lists
   other places in the same building, not the chain.
4. Find the wallet bleeder (restaurant and cafe-bar only): open the place's Menu tab on
   Zomato and pick the Food menu (not Bar or Beverages; for a café or bar whose menu is
   mostly drinks, its main menu). Read through its pages to the main dishes, find the dish
   the place is best known for (Zomato's "Top dishes" and "People say this place is known
   for" help pick it), and read that dish's price for one serving off the menu. If the Food
   menu won't open, try the menu on Swiggy, District or the place's own site. Leave the
   dish out if you cannot read a real price; never use the "cost for two".
5. Answer each job with submit_resolution, one call per job:
   - candidates: 1 to 5 places. Give one when you are sure; for a link, that is the outlet
     the link is for. Give up to 5 only when a plain name could mean several unrelated
     places; I pick one later.
   - name: as the place writes it.
   - category: restaurant, cafe-bar, movies, recreation or beach. Bars, pubs, cafés,
     bakeries and dessert shops are cafe-bar.
   - location: lat and lng of the place itself, from Google Maps or the expanded URL.
     They must be inside Mumbai (lat 18.85 to 19.35, lng 72.75 to 73.15).
   - address: short, area and city, e.g. "Kamala Mills, Lower Parel, Mumbai".
   - cuisine: for food and drink only, e.g. "Parsi" or "South Indian".
   - signatureDish: from step 4, with priceInr in whole rupees (no ranges).
   - sourceLinks: the https pages you used, at most 5.
   - chain: only for a chain from step 3. name is the chain's name, and outlets lists every
     other outlet in Mumbai (not the one in candidates), each with the same fields as a
     candidate: its own location, address and Zomato link in sourceLinks. Use the same
     signatureDish for each outlet unless its menu says otherwise. Leave out outlets
     outside Mumbai or ones you cannot place on the map. At most 40.
   - If you cannot find the place, or it is outside Mumbai, call submit_resolution with
     failed: true instead.
6. Never invent a fact. Leave out any optional field you could not check.
7. If submit_resolution returns an error, fix what it names and try once more; if it says
   the job no longer exists or was already answered, move on.
8. End with one line per job: the query, then "resolved", "resolved with N choices",
   "resolved, chain of N outlets" or "failed".
```

## Testing by hand

```sh
TOKEN=...  # the RESOLVER_TOKEN
curl -s https://map.snehilsinha.com/api/mcp -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_pending_jobs","arguments":{}}}'
```
