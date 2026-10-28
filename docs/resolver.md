# Resolver queue

Phase 3. Turns a name or link into place facts without the server learning who asked or
what they think of it. The code is `packages/crypto/src/resolver.ts` (format, checks,
sealing) and `apps/api/src/resolver.ts` (routes).

## Flow

1. The device makes a one-time X25519 keypair (`generateReplyKeys()`), keeps the secret
   key with its pending item, and posts the query with the public key. The request is
   **not signed**, so no account or device is attached.
2. The resolver lists pending jobs, looks each one up, and answers with up to five
   candidates or `{ "failed": true }`.
3. The Worker checks the answer (`parseResolution`: Mumbai bounds, known category, whole ₹
   price, https links), seals it to the job's key (`crypto_box_seal`) and clears the query.
4. The device polls its job, opens the result (`openResolverResult`, which re-checks it),
   writes the place facts, and deletes the job.

A job listed 5 times without an answer is marked failed. A failed job keeps its query until the device drops it or it expires, so the admin can put it back in the queue from Admin → Resolver; the device keeps checking a failed job until then. The hourly cron deletes jobs
14 days after they were made. At most 500 jobs can be pending at once.

Short Google Maps links (maps.app.goo.gl) usually don't need a job: the device calls
`POST /api/resolver/expand` and parses the full URL itself. When that fails, the job's
listing carries `expandedUrl` if the Worker can expand it later. A Zomato share link
(zomato.onelink.me) only carries a token the Zomato app opens, so its listing carries
`linkName`, the restaurant's name the Worker reads off the link-preview redirect (see
[mcp-resolver.md](mcp-resolver.md)); it never says which branch.

**Asking first:** the device adds a lone match by itself only for a link to one place. A
plain name or a Zomato share link always asks "Is this it?" in the Inbox, since a name can
mean another place.

**Putting it right:** a failed job, or matches the person doesn't want, can be looked up
again with a better link or name (a new job, with the same status, tags, note and boards;
a wrong link is dropped), or filled in by hand on `/fill`. The resolver side can list failed
jobs, put one back with a better query, or answer it directly. A place the resolver got
wrong can be corrected by the person who added it (Inbox → Wrong place?, or the place page)
for three days (`CORRECTION_WINDOW_MS`) while nobody else has a status, tag or comment on
it; the Worker checks the same. After that only the admin edits its facts.

## Device routes (no auth)

| Route | Body / response |
| --- | --- |
| `POST /api/resolver/jobs` | `{ query, replyPublicKey }` (query ≤ 1000 chars, key base64url 32 bytes) → `201 { id, status: "pending", expiresAt }`; `503 queue_full` |
| `GET /api/resolver/jobs/:id` | `{ id, status: "pending" \| "resolved" \| "failed", sealedResult?, expiresAt }`; `404` once deleted or expired |
| `DELETE /api/resolver/jobs/:id` | `204` |
| `POST /api/resolver/expand` | `{ url }` (a short Google Maps link) → `{ url }` full Maps URL, or (a Zomato share link) → `{ name }`; `422 not_expanded` |

`Api` in `@map-diary/sync` has `submitResolverJob`, `getResolverJob`,
`deleteResolverJob` and `expandMapsLink`.

## Resolver routes (`Authorization: Bearer $RESOLVER_TOKEN`)

| Route | Body / response |
| --- | --- |
| `GET /api/resolver/pending?limit=10` (max 50) | `{ jobs: [{ id, query, expandedUrl?, attempts, createdAt }] }`, oldest first. Each listing counts an attempt |
| `POST /api/resolver/jobs/:id/resolution` | `{ candidates: ResolvedPlace[] }` or `{ failed: true }` → `{ status }`; `400 <problem>` (see `ResolutionProblem`), `404`, `409 not_pending`. A failed job that still has its query can be answered too |
| `GET /api/resolver/failed?limit=10` (max 50) | `{ jobs }` like `/pending`, failed jobs newest first; counts no attempt |
| `POST /api/resolver/jobs/:id/requeue` | `{ query? }` → `{ status: "pending" }`; `400 bad_query`, `404` unless failed and still waited on |

`takePendingJobs`, `submitResolution`, `listFailedJobs` and `requeueJob` are exported so the MCP endpoint can call the
same logic.

## Result format

```ts
interface ResolverResult {
  v: 1;
  candidates: ResolvedPlace[]; // 1 to 5; more than one means the person picks in the Inbox
  chain?: {                    // only when the match is one outlet of a chain
    name: string;              // ≤ 200, e.g. "The Bombay Cartel"
    outlets: ResolvedPlace[];  // the chain's other outlets in Mumbai, ≤ 40, checked like candidates
  };
}

interface ResolvedPlace {
  name: string;                                   // ≤ 200
  category: "restaurant" | "cafe-bar" | "roadside-stall" | "desserts" | "movies" | "recreation" | "beach";
  location: { lat: number; lng: number };         // inside MUMBAI_BOUNDS, rounded to 6 dp
  address?: string;                               // ≤ 300
  cuisine?: string;                               // ≤ 100
  signatureDish?: { name: string; priceInr: number }; // food and drink categories only; whole ₹, 1 to 50,000
  sourceLinks: string[];                          // https only, ≤ 5
}
```

**Chains:** when `chain` is set the device always asks in the Inbox, even for one match:
"Add all N" writes every outlet as its own catalogue place labelled with the chain, with
the person's status, tags and note on the outlet they linked; "only this one" writes that
outlet alone, still labelled, so outlets added later join it. An outlet the catalogue already
has (same source link) is not added twice. Devices that predate `chain` ignore it.

**Signature dish** (default until Snehil writes the definition): the dish the place is
best known for, at its current menu price for one serving, in whole rupees.

## Setup

```sh
openssl rand -base64 32 | tr -d '\n' | pnpm --filter @map-diary/api exec wrangler secret put RESOLVER_TOKEN
```

The resolver routes answer `503 resolver_not_configured` until the secret is set.
