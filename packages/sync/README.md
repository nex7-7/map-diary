# @map-diary/sync

Everything a device does with the sync API (`apps/api/README.md`), with no UI: first-run setup, sign-in, the local store and the sync loop. All crypto goes through `@map-diary/crypto`.

- **Setup** (`prepareSetup`): makes a recovery phrase, derives the account key and Personal board key from it, makes this device's keys and seals the key backup under the passphrase. `complete(api)` creates the account once the phrase has been noted.
- **Sign-in** (`signInWithPassphrase`, `signInWithRecoveryPhrase`): registers a new device that the account key authorises, then gives it the board keys. Recovery also replaces the backup under a new passphrase.
- **Store** (`DiaryStorage`): `IdbStorage` in the browser, `MemoryStorage` in tests. Holds this device's keys, decrypted items, the push queue and the sync cursor. The account key is never stored on a device.
- **Sync** (`Diary`): `write` and `remove` land locally first, then a round pushes deletions, pushes envelopes and pulls until caught up. Last write wins per item on `updatedAt`. Each write picks its boards (Personal by default); a catalogue `place` always goes to the master board and a `private_place` never does.
- **Board key ring** (`boards.ts`): the boards the account is in and every key version this device holds for each. `refreshKeyRing` fetches and unwraps the keys wrapped to the account, `writeKey` picks the version new writes use, and the sync loop refreshes the ring whenever a pull shows a rotated key or a new board. Groups will reuse it as is.
- **Master board**: the admin's device creates it (`ensureMasterBoard`) at setup or, for an account set up before, on its next sync, then moves the admin's earlier places onto it. `wrapMasterKeysForAccount(device, accountBoxPublicKey)` wraps every master key version to a new account, for app invites; `masterKeysOf(device)` gives the raw keys for sealing into an invite instead. Revoking a device rotates the master key for every member.
- **Duplicates**: place envelopes are pushed with keyed hashes of their normalised source links (pass `placeLinks` to `Diary`), and `Diary.findCataloguePlace` asks the Worker for a place with the same link.

The web app wraps this in `apps/web/lib/device` (`useSession`, `useDiaryItems`, `DeviceGate`).

```sh
pnpm --filter @map-diary/sync test   # storage and bundle unit tests
pnpm --filter @map-diary/api test    # test/client.test.ts runs these flows against the real Worker
```
