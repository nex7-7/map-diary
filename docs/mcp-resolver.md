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
| `get_pending_jobs` | `{ limit?: 1-50 }` (default 10) | `{ jobs: [{ id, query, expandedUrl?, linkName?, attempts, createdAt }] }`. Each listing counts an attempt; 5 without an answer fails the job |
| `submit_resolution` | `{ jobId, candidates: ResolvedPlace[] }` or `{ jobId, failed: true }` | `{ jobId, status }`, or an error in plain words (outside Mumbai, bad price, already answered…) that Claude can fix and retry. A failed job can still be answered while `get_failed_jobs` lists it |
| `get_failed_jobs` | `{ limit?: 1-50 }` (default 10) | Failed jobs the device still waits on, newest first, same fields as `get_pending_jobs`. Listing counts no attempt |
| `requeue_job` | `{ jobId, query? }` | Puts a failed job back in the queue with fresh attempts, with `query` (a better link, or name and area) in place of the old one. A job still pending can have its `query` swapped the same way |

`expandedUrl` is the full Google URL behind a short link (`maps.app.goo.gl`, `goo.gl/maps`,
`g.co`, `share.google`). The Worker follows only the redirects, on Google hosts, and stops at
the first Google Maps URL or Google Search URL with a `q`; it never reads a page. A
`share.google` link from Google Search's Share button usually lands on a Search URL, which
names the place but has no pin.

`linkName` is the restaurant's name behind a Zomato share link (`zomato.onelink.me`). Those
links only carry a token the Zomato app opens; asked like a link preview
(`facebookexternalhit/1.1`), Zomato redirects once with the name in `af_og_title`, which the
Worker reads. It never says which branch, so the resolver searches the name like a plain
name and the person picks the branch in the Inbox.

**Fixing a failed job from a chat:** with the connector on, ask Claude to list failed jobs,
then give it the right link for one ("the Samai one is
https://www.zomato.com/mumbai/samai-marathmola-jewanachi-mejwani-lower-parel"). It calls
`requeue_job` with that link, and the next run resolves it; or it can look the place up and
answer it there and then. The answer still reaches only the device that asked.

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
   URL behind a short link. A Google Maps URL there gives the place's coordinates and name,
   the best evidence. A Google Search URL there (from a share.google link) gives, in its q,
   the place's name as Google knows it: look that name up as below. If linkName is present,
   the query is a Zomato share link that only opens the app: don't open it, but search
   Zomato for linkName in Mumbai and use its page; if several branches carry that name, give
   each one as a candidate. Search the web for anything else. A plain name means a place in
   Mumbai.
   Use the built-in browser whenever you have it: open links, Google searches, Zomato,
   District and Google Maps pages there, not with a web fetch or the code sandbox, which
   these sites refuse. Short links (share.google, link.district.in, maps.app.goo.gl) open
   to the real page in the browser. A Google search for "<name> <area> zomato" finds a
   branch's Zomato page even when it is new. District pages carry the pin as "latitude" and
   "longitude" in the page source, and a Google Maps page carries it in its URL.
   A new outlet may not be on Zomato or District yet: then also search Justdial, magicpin,
   Swiggy, EazyDiner and the brand's own site or store locator for the outlet's address
   (search "<name> <area> address" and "<name> <area> Mumbai"), and read its coordinates off
   a Google Maps result or OpenStreetMap for that address. An address at building or street
   level is enough for the pin. Fail only when no source you can read names the outlet;
   never submit another outlet of the chain in its place.
3. Check whether the place is one outlet of a chain. On its Zomato page, scroll down to the
   Direction box: a link such as "See all 3 The Bombay Cartel outlets in Mumbai" means it is.
   Open that link and note every outlet listed (name, area and address, and its own Zomato
   link). For a place that is not on Zomato, use Google Maps or the place's own site to find
   its other Mumbai outlets. Ignore "See all N outlets in <mall or compound>": that lists
   other places in the same building, not the chain. Zomato's list can be short: also check
   the brand's own site or store locator, Swiggy and District, and include every outlet in
   Mumbai, Thane and Navi Mumbai (Vashi, Belapur) that is inside the map's box. A brand name
   with a different prefix is a different chain run by different people: B Bhagat Tarachand
   and K Bhagat Tarachand are two chains, so list only the outlets of the exact brand.
4. Find the wallet bleeder (food and drink only). Open the place's Menu tab on Zomato and
   pick the Food menu (not Bar or Beverages). If it won't open, try the menu on Swiggy,
   District or the place's own site. Then:
   a. Decide what kind of place it is. A multi-course place (appetizers and mains, or small
      and large plates) is restaurant. A place focused on one item (burgers, pasta, ramen,
      pizza, momos, shawarma) is one-hit-wonder. Cafés, bars and coffee places are cafe-bar;
      dessert places are desserts; street stalls are roadside-stall.
   b. restaurant: find the appetizer section or its equivalent (Starters, Small plates). List
      every dish in it with chicken, and each one's price for one serving. Send rule
      "starters", section (the section's name), chicken: true and the dishes.
   c. one-hit-wonder or roadside-stall: find the section of the item the place sells (e.g.
      Burgers). List every chicken option in it with its price. Send rule "focused", section,
      chicken: true and the dishes.
   d. If the place serves no chicken, list that section's veg dishes instead and send
      chicken: false.
   e. cafe-bar or desserts: find the place's most popular dish (Zomato's "Top dishes" and
      "People say this place is known for" help) and its price. Send rule "popular" and that
      one dish.
   Send the dishes and their menu prices only; the diary takes the median itself. Leave the
   wallet bleeder out if you cannot read real prices; never use the "cost for two".
5. Answer each job with submit_resolution, one call per job:
   - candidates: 1 to 5 places. Give one when you are sure; for a link, that is the outlet
     the link is for. Give up to 5 only when a plain name could mean several unrelated
     places; I pick one later.
   - name: as the place writes it.
   - category: restaurant, one-hit-wonder, cafe-bar, roadside-stall, desserts, movies,
     recreation or beach, as decided in step 4a. Bars, pubs, cafés and bakeries are cafe-bar; ice cream, kulfi, mithai and dessert shops
     are desserts; street carts and stalls are roadside-stall.
   - location: lat and lng of the place itself, from Google Maps or the expanded URL.
     They must be inside Mumbai (lat 18.85 to 19.35, lng 72.75 to 73.15).
   - address: short, area and city, e.g. "Kamala Mills, Lower Parel, Mumbai".
   - cuisine: for food and drink only, e.g. "Parsi" or "South Indian".
   - signatureDish: from step 4: rule, section and chicken (not for popular), and dishes,
     each with its name and priceInr in whole rupees (no ranges), at most 40.
   - sourceLinks: the https pages you used, at most 5.
   - chain: only for a chain from step 3. name is the chain's name, and outlets lists every
     other outlet from step 3 (not the one in candidates), each with the same fields as a
     candidate: its own location, address and Zomato link in sourceLinks. Use the same
     category and signatureDish for each outlet unless its menu says otherwise. Leave out outlets
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
