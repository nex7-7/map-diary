# Android app

The Android app (`apps/android`) is the live site in a Capacitor WebView, plus what only a native
app can do: the share sheet and nearby alerts. Web changes reach the phone as soon as the site is
deployed; a new APK is needed only when something in `apps/android` changes.

## What it adds

- **Its own device.** The app has its own storage, so it registers as a separate `android` device.
  Link it from another device with Add a device, like any new browser.
- **Share target.** Share → Places Diary from Google Maps, Zomato or any app opens the Add sheet
  (through `/share`, as on the web).
- **Nearby alerts.** Each time the app runs, the page hands the Kotlin plugin
  (`proximity/ProximityPlugin.kt`) the id, name and pin of every outlet of my own Want to places,
  and nothing else. The plugin keeps them in app-private storage (excluded from backups) and
  registers Android geofences through Play services: the nearest 99 places, plus a 2 km fence
  around the phone whose exit registers the next 99 (only when there are more than 99). An alert
  goes off after lingering near a place, at most once per place per cooldown, never in quiet
  hours. The fences come back after a reboot or an app update. No position goes to any server.
- **Settings.** You → Nearby alerts, shown only in the app: the phone permissions (precise
  location, Allow all the time, notifications, battery with no restrictions), each with a button
  that opens it, and when to alert. Defaults: within 200 m, after 1 minute, once per place every
  3 days, quiet from 23:00 to 08:00.

## Building

GitHub Actions builds it (`.github/workflows/android.yml`) whenever `apps/android` changes, and
on demand from the Actions tab (Run workflow). Each run uploads the APK as an artifact; a push to
master also publishes it as a GitHub release named `android-<n>`.

Without the signing secrets the workflow builds a debug APK. Android installs an update over the
existing app only when both carry the same signature, so real builds need the release key below.

### One-time: the signing key

Make the key on your own computer. `keytool` comes with any Java (Temurin JDK 21 from
adoptium.net, or the one inside Android Studio). Keep `places-diary.jks` and its password somewhere
safe and outside the repo: losing it means uninstalling the app (and relinking it) to update.

```sh
keytool -genkeypair -v -keystore places-diary.jks -alias places-diary -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Places Diary"
```

Then, in GitHub → the repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the file as base64: `base64 -w0 places-diary.jks` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("places-diary.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `places-diary` |
| `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore's unless you set another) |

### Building locally

With Android Studio installed: `pnpm install`, then `pnpm --filter @map-diary/android sync`, then
open `apps/android/android` in Android Studio. `APP_URL=https://staging.map.snehilsinha.com` before
the sync makes an app that opens staging.

## Installing on the phone (CMF Phone 1, Nothing OS)

1. Download the APK from the latest `android-<n>` release (or a workflow run's artifact) and open it.
   Allow installs from that app when asked.
2. Open Places Diary and link it with Add a device from another device.
3. You → Nearby alerts: tap through each setting. "Allow all the time" opens the system location
   page; battery opens the "no restrictions" prompt.
