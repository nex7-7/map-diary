# @map-diary/sync

Everything a device does with the sync API (`apps/api/README.md`), with no UI: first-run setup, sign-in, the local store and the sync loop. All crypto goes through `@map-diary/crypto`.

- **Setup** (`prepareSetup`): makes a recovery phrase, derives the account key and Personal board key from it, makes this device's keys and seals the key backup under the passphrase. `complete(api)` creates the account once the phrase has been noted.
- **Sign-in** (`signInWithPassphrase`, `signInWithRecoveryPhrase`): registers a new device that the account key authorises, then gives it the board keys. Recovery also replaces the backup under a new passphrase.
- **Store** (`DiaryStorage`): `IdbStorage` in the browser, `MemoryStorage` in tests. Holds this device's keys, decrypted items, the push queue and the sync cursor. The account key is never stored on a device.
- **Sync** (`Diary`): `write` and `remove` land locally first, then a round pushes deletions, pushes envelopes and pulls until caught up. Last write wins per item on `updatedAt`. Phase 2 writes to the Personal board only.

The web app wraps this in `apps/web/lib/device` (`useSession`, `useDiaryItems`, `DeviceGate`).

```sh
pnpm --filter @map-diary/sync test   # storage and bundle unit tests
pnpm --filter @map-diary/api test    # test/client.test.ts runs these flows against the real Worker
```
