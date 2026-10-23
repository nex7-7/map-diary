// The diary's service worker, so the installed app opens without a network.
// scripts/write-service-worker.mjs fills in VERSION and STATIC_FILES and writes public/sw.js.
//
// - Pages: from the network when it answers within a few seconds, else the copy kept here.
// - Built files (/_next/static, hashed), map labels, icons: from this cache, kept on first use.
// - /share (the share target): only from this cache, so what was shared never reaches a server.
// - /api: never touched. The diary itself sits in IndexedDB and the map file in its own cache
//   (lib/map/map-file.ts), so both work offline already; nothing decrypted is cached here.

const VERSION = "__VERSION__";
const STATIC_FILES = __STATIC_FILES__;
const SHELL = `shell-${VERSION}`;

/** Pages kept for offline use. Each one's scripts, styles and fonts are kept with it. */
const PAGES = ["/", "/add", "/inbox", "/place", "/tags", "/boards", "/groups", "/devices", "/profile", "/share"];
const NETWORK_WAIT_MS = 4000;
const BUILT = /\/_next\/static\/[^"'\s)\\]+/g;

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("shell-") && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function precache() {
  const cache = await caches.open(SHELL);
  const built = new Set();
  for (const page of PAGES) {
    const res = await fetch(page, { cache: "reload" });
    if (!res.ok) throw new Error(`Could not keep ${page} (${res.status})`);
    const html = await res.text();
    for (const url of html.match(BUILT) ?? []) built.add(url);
    await cache.put(page, htmlResponse(html, res));
  }
  // Stylesheets name the fonts they load.
  for (const url of [...built]) {
    if (!url.endsWith(".css")) continue;
    const css = await (await fetch(url)).text();
    for (const font of css.match(BUILT) ?? []) built.add(font);
  }
  await cache.addAll([...built, ...STATIC_FILES]);
}

/** A fresh copy of a page, so a redirect is not replayed as one. Its headers, the CSP among them, stay. */
function htmlResponse(body, res) {
  return new Response(body, { status: 200, headers: res.headers });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(url.pathname === "/share" ? sharePage() : page(request, url.pathname));
  } else if (url.searchParams.has("_rsc") || request.headers.get("rsc")) {
    // Next.js page data for in-app navigation. Offline it fails, and Next.js then loads the
    // page in full, which the navigation branch answers from this cache.
    return;
  } else if (isStatic(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

function isStatic(path) {
  return (
    path.startsWith("/_next/static/") ||
    path.startsWith("/map/") ||
    path.startsWith("/icons/") ||
    path.startsWith("/paper/") ||
    path.startsWith("/cursors/") ||
    path === "/manifest.webmanifest"
  );
}

async function sharePage() {
  // Not kept yet (the first share before the app finished installing): fetch the page without
  // its query, and the page reads the query from the address bar.
  return (await caches.match("/share", { cacheName: SHELL })) ?? fetch("/share");
}

async function page(request, path) {
  const cache = await caches.open(SHELL);
  const network = fetch(request).then(async (res) => {
    if (res.ok && !res.redirected && PAGES.includes(path)) await cache.put(path, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // Offline: fall through to the kept copy.
  }
  const kept = await cache.match(path);
  if (kept) return kept;
  // Slow but not offline, or a page not kept here: wait for the network after all.
  try {
    return await network;
  } catch {
    return offline();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL);
  const kept = await cache.match(request, { ignoreSearch: true });
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") await cache.put(request, res.clone());
  return res;
}

function offline() {
  const body =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Offline · Mumbai Places Diary</title>' +
    '<body style="font:16px/1.5 system-ui,sans-serif;background:#efe8d9;color:#2a2622;padding:24px">' +
    '<h1 style="font-size:22px">You are offline</h1>' +
    '<p>This page has not been opened on this device yet. <a href="/">Open your diary</a></p>';
  return new Response(body, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}
