import type { CapacitorConfig } from "@capacitor/cli";

// The app is the live site in a WebView, so web changes reach the phone without a new APK.
// APP_URL=https://staging.map.snehilsinha.com builds one that opens staging instead.
const url = process.env.APP_URL ?? "https://map.snehilsinha.com";

const config: CapacitorConfig = {
  appId: "com.snehilsinha.map",
  appName: "Places Diary",
  // Shown only if the site cannot be reached on first launch.
  webDir: "www",
  server: { url, cleartext: false },
  android: { allowMixedContent: false },
};

export default config;
