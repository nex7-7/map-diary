# Errors and what people see

Every failure the app can meet has a code, and `apps/web/lib/errors/messages.ts` is the one place that turns a code into a sentence. Screens never show `err.message` from an unknown error, never show a code, and never echo what was typed or anything decrypted. `apps/web/test/errors.test.ts` fails if the API starts returning an error code, or refusing a pushed envelope for a reason, that has no words here.

## Where errors show

| Situation | How it shows |
| --- | --- |
| A form the person can fix (setup, sign-in, invite, Add sheet, place details, passphrase, device name, profile, groups, admin forms) | Inline under the form, `role="alert"`, via `userMessage(err)` |
| A one-tap action on a page (status, tag, comment, edit or delete on the place page; Inbox choices; Tags page; swipe to mark Visited) | Error toast via `toastError(err)` |
| Sync goes offline | One info toast per outage; a success toast when the next round lands |
| A sync round fails (`SYNC` table) | One error toast per distinct problem; "Syncing again." when it recovers |
| The server refuses one of this device's writes (`REJECTED` table) | Error toast saying the item stayed on this device only |
| This device was removed or the server no longer knows it | No toast: the device signs out and the welcome screen explains (unchanged) |
| The map can't load | The map's own "Try again" card, via `mapLoadMessage(err)` |
| A promise fails with nobody handling it | Error toast via the global listener (`app/_shell/error-listener.tsx`) |
| A screen throws while rendering | `app/error.tsx`: "This screen couldn't open", Try again, Back to the diary |
| Resolver lookups that fail | Inbox rows, with their own reasons (unchanged) |

Toasts use sonner (`components/ui/sonner.tsx`, styles in `app/toast.css`), pinned top-centre below the notch so the phone nav strip and the Add sheet never cover them. They work the same in the browser and in the installed app. The same sentence replaces itself instead of stacking.

## Error sources

- **API Worker** answers `{ "error": code }` (`apps/api/src/http.ts`); the client raises `ApiError(status, code)` or `NetworkError` when there is no response. Feature wrappers in `@map-diary/sync` turn these into typed errors: `SetupError`, `PairingError`, `RevokeError`, `InviteError`, `ClaudeError`, `GroupError`. Anything unwrapped falls back to the `API` table.
- **Push rejections**: `POST /envelopes` refuses single envelopes with a reason; `Diary.onRejected` reports them. `stale_key` and `place_not_on_master` are re-sealed automatically and never shown.
- **Local writes**: `WriteError` from `Diary.write` and `Diary.remove`.
- **Crypto**: `CryptoError` from `@map-diary/crypto`; its own messages are developer text and are never shown.
- **Web refusals**: `EntryError` (in `lib/entries/actions.ts`) carries a sentence written for people and is shown as is. The pending queue, admin merge and device naming use it too.
- **Browser**: `QuotaExceededError` (storage full), `NotAllowedError`, offline `fetch` failures.
- **Map file**: `MapFileError`.

## Messages

### SETUP

| Code | Message |
| --- | --- |
| `passphrase_too_short` | Use at least 12 characters. A short sentence works well. |
| `passphrase_too_weak` | That passphrase is too easy to guess. Try four or five unrelated words, like a silly sentence only you would write. |
| `too_many_tries` | Too many tries in a short time. Wait a minute, then try again. |
| `wrong_passphrase` | That passphrase didn't match. Check it and try again. |
| `invalid_recovery_phrase` | That recovery phrase has a typo. Check each group of four. |
| `unknown_recovery_phrase` | No account uses that recovery phrase. |
| `registration_closed` | This diary is already set up. You need an invite link to join, or sign in if you already have one. |
| `passphrase_in_use` | Choose a different passphrase. |
| `bad_invite` | That invite code has a typo. It is twenty letters and digits, like 7K3QM-9XT2B-QW4RT-ZP0HK. |
| `invite_invalid` | That invite has expired or was already used. Ask for a new one. |
| `invite_stale` | That invite is out of date because the diary's keys changed since it was made. Ask for a new one. |
| `wrong_account` | That recovery phrase belongs to a different account. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### PAIRING

| Code | Message |
| --- | --- |
| `bad_code` | That code has a typo. It is ten letters and digits, like 7K3QM-9XT2B. |
| `expired` | That code has expired or was already used. Make a new one on your other device. |
| `tampered` | The device that answered didn't come from your code, so it wasn't added. Make a new code and try again. |
| `too_many` | There are already a few codes waiting. Wait ten minutes for them to expire, then make a new one. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### REVOKE

| Code | Message |
| --- | --- |
| `wrong_passphrase` | That passphrase didn't match. Check it and try again. |
| `invalid_recovery_phrase` | That recovery phrase has a typo. Check each group of four. |
| `wrong_account` | That recovery phrase belongs to a different account. |
| `stale` | Your devices changed while this was open. Try again. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### INVITE

| Code | Message |
| --- | --- |
| `too_many` | There are already ten open invites. Cancel one first. |
| `no_master` | The Public board isn't set up on this device yet. Open the diary, let it sync, then try again. |
| `stale` | The diary's keys just changed. Open the diary, let it sync, then try again. |
| `not_found` | That's already gone. Reload to see the latest. |
| `forbidden` | Only the admin can do that. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### CLAUDE

| Code | Message |
| --- | --- |
| `already_connected` | Claude is already connected. Remove it first to connect it again with a new secret. |
| `stale` | The diary's keys just changed. Try again. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### GROUP

| Code | Message |
| --- | --- |
| `invalid_link` | That isn't a whole invite link. Ask for the link again and paste all of it. |
| `invite_not_found` | That invite has expired or was already used. Ask for a new link. |
| `already_member` | You're already in this group. |
| `group_full` | This group already has 10 people, the most a group can have. |
| `empty_name` | A group needs a name. |
| `too_many_groups` | You're in as many groups as the diary allows. Leave one first. |
| `stale` | The group changed while this was open. Reload and try again. |
| `offline` | You're offline. Connect and try again. |
| `server` | Something went wrong on the server. Try again in a moment. |

### WRITE

| Code | Message |
| --- | --- |
| `not_found` | That's no longer on this device. It may have been deleted on another device. |
| `not_author` | Only the person who wrote that can change it. |
| `immutable` | That can't be moved to another place. Delete it and add it again. |
| `no_board_key` | This device doesn't have the key for one of the boards you picked yet. Let it sync, then try again. |

### CRYPTO

| Code | Message |
| --- | --- |
| `bad_signature` | Something on this device didn't check out, so it was left alone. Reload the app. |
| `no_board_key` | This device doesn't have the key for that yet. Let it sync, then try again. |
| `decrypt_failed` | This device couldn't open that. Let it sync, then try again. |
| `bad_payload` | Something on this device didn't check out, so it was left alone. Reload the app. |
| `bad_backup` | That passphrase didn't match. Check it and try again. |
| `unsupported_version` | This needs a newer version of the app. Reload to update. |
| `invalid_input` | That doesn't look right. Check it and try again. |

### API

| Code | Message |
| --- | --- |
| `bad_request` | The app sent something the server didn't understand. Reload the app to update it. |
| `bad_json` | The app sent something the server didn't understand. Reload the app to update it. |
| `unauthenticated` | The server didn't recognise this device. Check the time on this device, then reload. |
| `forbidden` | You don't have access to that. |
| `not_found` | That's already gone. Reload to see the latest. |
| `conflict` | That changed on another device while this was open. Reload and try again. |
| `stale` | The diary's keys just changed. Let it sync, then try again. |
| `too_large` | That's too big to save. Try something smaller. |
| `too_many_tries` | Too many tries in a short time. Wait a minute, then try again. |
| `device_revoked` | This device was removed from your account. |
| `device_unknown` | The server no longer knows this device. Sign in again. |
| `claude_not_allowed` | The Claude connector can't do that. |
| `own_device` | You can't remove your own device from here. Use Devices on another one. |
| `cannot_revoke_self` | You can't remove the device you're using. Remove it from another device. |
| `cannot_remove_self` | You can't remove yourself from the diary. |
| `bad_account_signature` | That passphrase or recovery phrase didn't match this account. |
| `lookup_taken` | Choose a different passphrase. |
| `no_master_board` | The Public board isn't set up yet. Open the diary, let it sync, then try again. |
| `resolver_not_configured` | Place lookups aren't set up on the server yet. |
| `queue_full` | Too many places are waiting to be looked up. Try again in a few hours. |
| `registration_closed` | This diary is already set up. You need an invite link to join. |
| `invite_invalid` | That invite has expired or was already used. Ask for a new one. |
| `invite_stale` | That invite is out of date because the diary's keys changed since it was made. Ask for a new one. |
| `too_many_invites` | There are already ten open invites. Cancel one first. |
| `already_member` | You're already in this group. |
| `group_full` | This group already has 10 people, the most a group can have. |
| `too_many_groups` | You're in as many groups as the diary allows. Leave one first. |
| `too_many_pairings` | There are already a few codes waiting. Wait ten minutes for them to expire, then make a new one. |
| `not_joined` | The other device hasn't joined yet. Wait for its code to show, then approve. |
| `claude_connected` | Claude is already connected. Remove it first to connect it again with a new secret. |
| `master_exists` | The Public board is already set up. Reload the app. |
| `not_expanded` | That link couldn't be opened. Paste the full Google Maps link instead. |
| `bad_device_authorization` | The device that tried to join wasn't approved properly. Make a new code and try again. |
| `board_not_allowed` | You're not on that board any more. Reload to see the latest. |
| `internal` | Something went wrong on the server. Try again in a moment. |

### REJECTED

| Code | Message |
| --- | --- |
| `duplicate_place` | That place is already in the diary, so yours stayed on this device only. Search for it and add your status there. |
| `board_not_allowed` | You're no longer on one of the boards you picked, so that change stayed on this device only. |
| `facts_locked` | Only the admin can change a place's details now, so your edit stayed on this device only. |
| `private_on_master` | A dropped pin can't go on the Public board, so it stayed on this device only. |
| `not_author` | Only the person who wrote that can change it, so your edit stayed on this device only. |
| `immutable_field` | That change isn't allowed, so it stayed on this device only. |
| `bad_signature` | The server couldn't verify a change from this device, so it stayed here only. Reload the app. |
| `invalid` | The server couldn't read a change from this device, so it stayed here only. Reload the app to update it. |
| `deleted` | _(no message: handled quietly)_ |
| `duplicate` | _(no message: handled quietly)_ |

### SYNC

| Code | Message |
| --- | --- |
| `device_revoked` | _(no message: handled quietly)_ |
| `device_unknown` | _(no message: handled quietly)_ |
| `unauthenticated` | The server didn't recognise this device, so it can't sync. Check the time on this device, then reload. |
| `too_large` | A change is too big to sync. Try a smaller photo or a shorter comment. |
| `client_error` | This device couldn't finish syncing. Your changes are kept here; reload to try again. |

### Anything else

`Something went wrong. Try again, and reload the app if it keeps happening.`
