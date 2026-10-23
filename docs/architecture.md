# Mumbai Places Diary — Architecture Brief

As of 2026-10-19 · Snehil

## Overview

A private, end-to-end encrypted map diary of Mumbai places I have been to and want to go to, shared selectively with two friend groups. It replaces a text list in a notes app and must feel just as quick to add to.

- **Users:** me, plus a group of 4 (including me) and a group of 2 (including me). Friends use iPhones and are not technical.
- **Core jobs:** add a place (name, link or dropped pin), tag it, comment on it, mark it Visited or Want to, and see everything on a map.
- **Signature features:** per-opinion visibility (boards), custom tags with descriptions, a wallet bleeder (a signature dish and its price) for food places, Claude-assisted resolution, and proximity alerts on my Android phone.
- **Scope:** Mumbai only for now; the data model does not assume a city.

## Principles and constraints

1. **Zero extra cost.** Only Cloudflare's free tier, my own domain (snehilsinha.com) and my existing Claude subscription. No paid APIs, app stores or developer accounts.
2. **The server is blind.** All opinion content (Public, Group and Private) is encrypted on the device; the server stores ciphertext it cannot read.
3. **Location never leaves the device.** GPS is used only on the phone, for distance sorting and proximity alerts.
4. **Friction as low as a notes app.** Adding a place takes one or two taps; enrichment happens later in the background.
5. **Friend groups never mix.** Each group's content is readable only by that group.
6. **No home server.** Everything runs in the cloud; self-hosting can come later.
7. **No hand-rolled crypto.** Use vetted libraries (libsodium) only.

## Platforms and clients

One web codebase serves every platform; only my Android phone gets a native shell.

| Capability | Web app (iOS, Android, desktop) | Android app (me only) |
| --- | --- | --- |
| Install | Add to Home Screen / Install app; Firefox desktop as a bookmark | Sideloaded APK built with Capacitor |
| Add by name, link or dropped pin | Yes | Yes |
| Share from other apps | Android Chrome: share target · iOS: none (paste) · desktop: bookmarklet | Native share target |
| Claude | Via Claude connector on any device | Same |
| Near-me sorting | Yes, on device, only when tapped | Yes |
| Proximity alerts | No | Yes, on-device geofencing |
| Offline viewing | Yes (local data + Mumbai map file) | Yes |

On iOS the app must be installed to the Home Screen so Safari does not evict its storage and keys.

## System components

Everything runs on one free Cloudflare account behind `map.snehilsinha.com`; nothing outside the devices can read opinion content.

```
 Web app            Android app        Claude assistant     Resolver task
 (keys, GPS)        (geofencing)       (own device key)     (sees link/name only)
     │ ciphertext       │ ciphertext       │ MCP, per call        │ jobs
     ▼                  ▼                  ▼                      ▼
 ┌──────────────── Cloudflare (free tier) ─────────────────────────────┐
 │  API Worker @ map.snehilsinha.com                                   │
 │  sync · invites · key backups · MCP server · resolver job queue     │
 │        │                                   │                        │
 │   D1: sealed envelopes,               R2: Mumbai PMTiles map,       │
 │       wrapped keys, devices               cached on each device     │
 └─────────────────────────────────────────────────────────────────────┘
```

- **Worker:** the only server code. Serves the sync API, invites, encrypted key backups, the MCP server for Claude, and the resolver job queue.
- **D1:** one row per envelope, plus wrapped keys and device records.
- **R2:** the Mumbai offline map file (PMTiles), downloaded once and cached.
- **Cron trigger:** expires stale resolver jobs. No other scheduled work.
- **Domain:** bought on Namecheap, DNS on Cloudflare; only the `map` subdomain is added.

## Stack

Next.js, React and TypeScript on Cloudflare, with all decryption in the browser.

- **Web app:** Next.js + React + TypeScript (strict), built as a static export (`output: "export"`) and served as Cloudflare Workers static assets, so page requests run no Worker code and use no CPU budget; security headers come from a `_headers` file. Fully client-rendered, since the server cannot read the data.
- **API Worker:** a separate small Worker (Hono) for sync, invites, key backups, the resolver queue and the MCP server.
- **On-device store:** IndexedDB holding the device's keys, decrypted items and pending places, each record sealed (AES-GCM) under a per-browser key made with WebCrypto as non-extractable, so a copy of the browser's files cannot be read elsewhere. Code running inside the open app can still use it.
- **Crypto:** libsodium (libsodium-wrappers).
- **Map:** MapLibre GL with a Mumbai PMTiles file from R2.
- **Android:** Capacitor shell plus a custom Kotlin geofencing plugin. Target device: CMF Phone 1 (Nothing OS).
- **Claude:** Pro plan. Custom connector for the MCP server; a scheduled task for the resolver.

## Data model and visibility

Places hold shared facts, people attach opinions to them, and every opinion is posted to one or more boards. A board is simply an audience with its own key.

| Board (audience) | Members | Encrypted with | Claude assistant can read |
| --- | --- | --- | --- |
| Master (Public) | Everyone on the app | Master key | Yes |
| Each group | That group's members | That group's key | No |
| Personal (Private) | Only me | My personal key | Yes, mine only |

**Objects**

| Object | Contents | Visible on |
| --- | --- | --- |
| Place (catalogue) | name, category, coordinates, address, source links, cuisine, signature dish and price | Master; created once, shared by everyone |
| Private place | the same fields, for a dropped pin | The boards its owner picks; never in the catalogue |
| Status opinion | Visited or Want to; puts the place on my list | One or more boards |
| Tag definition | name, emoji, description | One or more boards |
| Tag opinion | a tag applied to a place | One or more boards |
| Comment opinion | text | One or more boards |
| Group | name, members, key version | Its members |

**Envelope:** each opinion is encrypted once with a random content key, and that key is wrapped once per chosen board. The server sees only the id, type, author, place id, which boards, timestamps and signature.

**Rules**

- Nothing is visible outside the app. The master board is everyone on the app.
- A place is on my list only when I have a status opinion (Visited or Want to) on it. Tags and comments need a status first.
- Each opinion picks its own boards. My Visited can be Public while my comment on the same place stays Private.
- One opinion can go to several boards, for example both my groups but not master.
- A board only shows opinions from its own members. A group member's Public opinion appears on that group's board; a non-member's Public opinion appears only on the master board.
- **A group's list** is every place where some member has a status opinion on that group's board or the master board.
- Anyone who can see a place can tag and comment on it, at a visibility no wider than their own access.
- A tag opinion can only go to boards where its tag definition is also visible; the app warns and offers to widen the definition.
- **Facts:** written once by the first resolution. After that, only the admin can edit them. Duplicate places are blocked by a keyed hash of the normalised source link, which the server can check without reading the place.
- Dropped pins are private places and never enter the shared catalogue.
- **Chains:** each outlet of a chain is its own catalogue place (own pin, address, links and duplicate check), and its facts carry the chain's id and name. The app folds a chain's outlets into one place page with a row per location, one list entry, and a pin per outlet. Status and tags count for the whole chain (one status per person); a comment is about one outlet or all of them. Boards work as for any place. The resolver returns a chain's other outlets and the Inbox asks whether to add all of them or only one. Only the admin can add an existing place to a chain (Edit details → Part of a chain).
- **Categories:** Restaurant, Café/Bar, Movies, Recreation, Beach, plus custom ones.
- **Wallet bleeder:** food and drink only. The signature dish and its menu price in ₹, with no tiers. The definition of "signature dish" is still to be written.

**Decided**

- Every new opinion defaults to the Personal board.
- When someone leaves a group, their opinions on that group's board disappear for everyone: the envelopes are deleted, the group key is rotated, and other members' apps drop their cached copies on the next sync.
- No moderation. Nobody, including the admin, can hide or delete another person's opinion.

## Encryption and key management

Keys sit at three levels: each board has a symmetric key, board keys are wrapped to people (accounts), and each person's account key is wrapped to each of their devices. The server only ever stores keys in wrapped (encrypted) form.

- **Recovery seed:** 128 random bits, shown once at setup as a 28-character recovery phrase. Every version of a person's account keys and personal board key is derived from it, so the phrase alone restores the whole account.
- **Account keys (one set per person):** an X25519 keypair that board keys are wrapped to, and an Ed25519 keypair that proves which devices belong to the account. Both are versioned; revoking a device moves the account to the next version.
- **Device keys (one set per device):** an X25519 and an Ed25519 keypair generated on the device. The device signs every request and envelope with its own key, and holds the account keys wrapped to its X25519 key.
- **Personal board key:** a symmetric key for the Personal board, derived from the recovery seed per version.
- **Master key:** one symmetric key encrypts the master board and the place catalogue, wrapped to every person's account key, so the server cannot read Public items either.
- **Group keys:** one symmetric key per group (XChaCha20-Poly1305), wrapped to each member's account key. Rotation re-wraps for people (at most 10), not for every device.
- **Invites:** links shared over WhatsApp, with the secret after the `#`, which browsers never send to the server. An **app invite** (admin only, one-time, expires in 7 days) lets a friend create an account and grants the master key; it replaces open signup, which exists only for the very first (admin) account. A **group invite** (any member) grants that group's key.
- **Adding a device:** on a device you already have, open "Add a device" to show a QR code or link (secret after the `#`). The new device scans it, or types the 10-character code shown under it (on iPhone a scanned link opens in Safari, not the installed app, so the code is typed in the app), and sends its public keys through a short-lived pairing slot on the Worker; both screens show the same 6-character code and you approve on the old device, which authorises the new one and wraps the account keys to it. The server accepts a new device authorised by any active device of the same account. Passphrase sign-in stays as the fallback when no other device is at hand.
- **Passphrase backup:** the recovery seed and board keys, encrypted with a key derived from a passphrase (Argon2id) and stored on the server. Optional for friends (they can set one later); the recovery phrase is mandatory for everyone.
- **Devices screen and revocation:** each person sees their devices (name, kind, added, last seen) and can revoke any other one. The server refuses the revoked device at once; one of the person's remaining devices then moves the account keys to the next version, re-wraps them for the remaining devices, and rotates every board the person is in (personal, master and their groups) so the revoked device cannot read anything new. Confirming a revoke needs the passphrase or the recovery phrase, because the next account keys and personal board key are derived from the recovery seed, which devices do not keep. The Worker enforces this: the new account key must carry a signature by the account signing key, which is also derived from the seed, and so must a replacement passphrase backup. The whole revoke is one Worker call; the other devices collect their copy of the new account key on their next sync, and a write sealed under the old key is refused and re-sealed. The admin can revoke any device on the app but still cannot read anyone's boards.
- **Lost devices and recovery:** with another device, revoke the lost one there. With no other device, sign in with the passphrase or the recovery phrase on a new device, then revoke the old ones. The recovery phrase restores every board, because shared board keys are wrapped to account keys the seed derives. Losing every device, the passphrase and the recovery phrase means the data is unrecoverable; the admin cannot help.
- **Leaving a group:** nobody can remove another member from a group; people only leave. When someone leaves, a remaining member's device rotates the group key and re-wraps it for the others. When the admin removes someone from the app entirely, that person leaves all their groups and the master and group keys rotate.
- **Devices as members:** my phone, my laptop browser, the Android app and the Claude connector are each separate devices (kind `web`, `android` or `claude`) with their own key, so any one can be revoked alone.
- **Sync engine: custom, on libsodium.** Every item has exactly one author, so two people never edit the same item. Sync is last-write-wins per envelope, with no CRDT needed. Jazz (v2 trusts the server for access control; classic is in maintenance) and Evolu (single-secret shared owners, no per-member revocation, relay not on Workers) were considered and rejected.

## Core flows

Adding saves instantly on the device; everything slow happens afterwards.

**Add a place**

1. Share a link to the app, paste a link or name into the Add sheet, or long-press the map to drop a pin.
2. The Add sheet shows category, status, tag chips, description and a board picker. Defaults: Want to, Personal board. Only the save tap is required.
3. The item is encrypted on the device and synced immediately.
4. Google Maps links resolve on the device (coordinates are in the expanded URL). Dropped pins need no resolution.
5. Zomato, District and plain names go to the resolver queue and show as pending in the Inbox until resolved.

**Manage**

- **Map:** pins styled by status and category, filters for board, tag, category, cuisine, signature-dish price and author.
- **List:** the same filters, sorted by distance, date added or price; swipe to mark visited.
- **Inbox:** pending resolutions, results that need a choice between matches, and new items from friends.
- **Place page:** all visible tags and comments with author and board badge, links, and Open in Google Maps.
- **Tags:** create, edit and set the boards of custom tags and their descriptions.
- **Groups:** create a group, invite by link, leave a group (nobody can remove someone else).

**View**

The map uses a Mumbai map file (PMTiles) stored in R2 and cached on the device, so browsing never reveals which area I look at. Near-me sorting asks for location only when tapped.

## Admin panel

I am the only admin. The panel is a hidden route in the same app, unlocked by my admin device key, and the Worker checks my signature on every admin action.

- **Places:** edit facts, re-run the resolver on a place, merge duplicates, delete a place.
- **Resolver:** see the queue and failed jobs, retry them.
- **Members:** invite people to the app, remove them (rotates the master key), and see which groups exist.
- **Devices:** list every device, including the Claude connector, and revoke any one.
- **Data:** export D1 as a backup and check storage usage against the free tier.

Admin power is enforced by the server, not by keys: it can change shared facts and membership, but it cannot read any group board I am not in or anyone's personal board.

## Claude integration

Claude has two separate roles: a resolver that only ever sees a name or link, and my personal assistant that sees the master board and my personal board, never group boards.

**1. Resolver (any AI, minimal view)**

1. The device submits an anonymous job: the link or name plus a one-time public key. No account is attached.
2. A Claude scheduled task calls `get_pending_jobs` and `submit_resolution` on the Worker's resolver endpoint. It returns name, coordinates, category, cuisine, the signature dish and its menu price.
3. The Worker validates the result (coordinates inside Mumbai, a plausible ₹ price), encrypts it to the job's key, and deletes the job.
4. My device picks it up on the next sync and writes the place facts.

The resolver interface is generic, so another AI or a script could replace Claude.

**2. Personal assistant (me only)**

- **Scope:** the master board and my Personal board. Never any group board.
- Claude is a registered device on my account (kind `claude`). Unlike my other devices it never gets my account keys, since those open every board I am in, groups included. Instead the master and Personal board keys (every version) are wrapped directly to its device key, so group data is cryptographically out of reach.
- **Connecting:** on one of my devices, Devices → Connect Claude creates the Claude device keys in the browser, wraps the master and Personal keys to it, and makes a random connector secret. The device's secret keys are encrypted with a key derived from that secret and stored on the Worker with a hash of the secret; the secret is shown once, pasted into the connector's request header, and forgotten by the browser. The server alone cannot unlock the Claude device.
- **Per call:** the connector sends the secret; the Worker finds the device by its hash, unlocks its keys, decrypts what the tool needs, answers, and keeps nothing. While a call runs, the Worker and Anthropic see that plaintext. Signatures are checked when envelopes are pushed, so reads only decrypt.
- **Keeping up with rotations:** when the master or my Personal key rotates (a revoke, a member removed), whichever of my devices syncs next wraps the new version to the Claude device. Until then Claude reads only older items and refuses writes with a plain "open the app once" message.
- **Guardrails on the Worker:** a `claude` device is refused account keys, group board keys, admin actions, and editing place facts it did not create. It has its own MCP endpoint and connector, separate from the resolver.
- **Tools:** search and list places, get a place with its visible tags and comments, list tags, add a place (Claude looks it up itself and the Worker checks the facts like a resolver result, including the duplicate link check), set Visited or Want to, add tags and comments. New opinions default to the Personal board, as everywhere. Pending items live only on the device that made them, so they stay with the resolver connector.
- Items Claude creates are signed by the Claude device and shown as "Snehil via Claude".
- Revoking Claude uses the normal revoke: its device row and encrypted keys are deleted, and the master and Personal keys rotate.

## Android app and proximity alerts

The sideloaded Android app is the only place proximity alerts exist, and the server is never involved.

- **Shell:** Capacitor wrapping the same web app, pointed at the live site so web changes ship instantly. The APK is rebuilt only when native code changes.
- **Geofencing:** a small custom plugin (about 150 lines of Kotlin) around Android's `GeofencingClient`. No paid background-location plugin.
- **Local cache:** when the app runs, it decrypts my Want to places and stores only names and coordinates in app-private storage, so alerts work while it is closed.
- **Rolling set:** the nearest 99 wishlist places plus one 2 km "refresh" fence around me. Leaving it re-registers the next 99.
- **Anti-spam:** alert after about a minute of dwell within about 200 m, a cooldown of a few days per place, and quiet hours.
- **Android quirks:** "Allow all the time" location, notification permission (Android 13+), re-register fences after reboot, and exclude the app from battery optimisation (Nothing OS).
- **Scope:** alerts only for me. iOS and the web app get no proximity alerts.

## Privacy ledger

| Party | Master board | Group boards | My Personal board | Who is in which group | My location |
| --- | --- | --- | --- | --- | --- |
| My devices | Yes | My groups | Yes | Yes | On device only |
| Other app members | Yes | Only groups they are in | No | Only groups they are in | No |
| Cloudflare Worker and D1 | No (ciphertext) | No | No | Yes (envelope metadata) | No |
| Resolver AI | Only an anonymous link or name | No | No | No | No |
| Claude as my assistant | Yes, during calls | No | Yes, during calls | No | No |
| Map and search providers | No | No | Search queries only | No | No (offline map file) |

**Known leaks, accepted:** envelope metadata (authors, boards, group ids, timestamps) is visible to the server; a typed name sent to a search service reveals that query; assistant calls expose the master board and my personal board to the Worker and Anthropic while they run.

## Risks, out of scope, later

**Risks**

- **Key loss:** a forgotten passphrase with no other device loses everything. Mitigation: recovery phrase shown at setup, plus a second device.
- **Zomato and District blocking:** pages may refuse automated reads. Mitigation: fall back to the name, or a menu screenshot for the price.
- **iOS storage eviction:** a web app not installed to the Home Screen can lose its keys. Mitigation: require install before setup.
- **Free-tier changes:** Cloudflare could change limits. Mitigation: D1 exports to a plain SQLite file.
- **Android battery killers:** OEM power savers can silently stop alerts.
- **Crypto bugs:** mitigated by using libsodium, never custom primitives.
- **Worker CPU limit:** the free tier allows about 10 ms of CPU per request, and assistant calls decrypt on the Worker. Mitigation: decrypt only (no signature checks on read), only the boards and items a tool needs, and measure with real data before relying on it.

**Out of scope for now:** proximity alerts on iOS and the web; push notifications of any kind; cities beyond Mumbai; a Play Store listing; self-hosting; moderation.

**Later:** self-hosting the relay; import from my existing notes list; export to Google Maps lists; photo attachments in R2.

## Build phases

Each phase ends with something I can use daily.

Status as of 2026-10-19: Phases 1 to 4 are live, and rotating the master key when the admin removes a member (PR #23) is merged. Phase 5 is merged: the master board and app invites are live; groups (migration 0008), friends' opinions and PR #23 are waiting to be deployed. Phase 6 is being planned.

1. **Foundation:** Next.js + TypeScript project, API Worker on `map.snehilsinha.com`, D1 envelope schema, R2 with the Mumbai map file.
2. **Solo diary:** keys and passphrase backup, envelope sync, Add sheet, map and list, dropped pins, Google Maps link parsing, categories, tags, comments, Visited. Personal board only.
3. **Resolver:** anonymous job queue, Claude scheduled task, signature dish and price, Inbox.
4. **Accounts and devices:** per-person account keys with board keys wrapped to people, device kinds, QR device linking, Devices screen with revocation and key rotation, admin app invites.
5. **Sharing:** master key and the master board, groups and invites, tagging and commenting on others' places, member removal with key rotation. The place catalogue moves from the Personal board to the master board, and revoking a device or removing a member also rotates the master and group keys.
6. **Claude assistant:** Connect Claude on the Devices screen, a Claude device holding only the master and Personal keys, its own MCP connector with read and write tools, the "via Claude" label, revocation.
7. **Android app:** Capacitor shell, native share target, geofencing plugin.
8. **Friends onboarding:** install guide for iPhone, import of my existing notes list.

## Open questions

**Content**

- [ ] Definition of "signature dish" for the wallet bleeder. (Default in use: the dish the place is best known for, at its current menu price for one serving, in whole ₹.)
- [ ] Final category list, and are custom categories personal or shared?
- [ ] Are custom tags personal, or can others reuse a tag they can see?
- [ ] Photos on places: needed now, later, or never?

**Claude**

- [ ] Confirm scheduled tasks are available on my Pro plan; if not, I trigger the resolver from chat.
- [ ] How often should the resolver run? (Default in use: every 6 hours.)
- [ ] Should Claude post to the master board when asked, or only to my Personal board? (Default: either, Personal unless I say otherwise.)

**Technical**

- [x] Passphrase or passkeys for friends' key backup? Recovery phrase mandatory, passphrase optional; passkeys (WebAuthn PRF) revisited later.
- [ ] Is offline adding (no network) required?
- [ ] Proximity alert radius, cooldown and quiet hours.
- [ ] Format of my existing notes list for import.
- [ ] A name for the app.
