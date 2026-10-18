/**
 * Short Google Maps links (maps.app.goo.gl, goo.gl/maps, g.co/kgs) only carry the place
 * in their redirect target. This follows the redirects, fetching Google hosts only, and
 * returns the first full Google Maps URL. It never reads a page body.
 */

const MAX_HOPS = 6;

/** Matches the web app's isShortGoogleMapsLink in lib/entries/parse-input.ts. */
export function isShortMapsLink(raw: string): boolean {
  const url = parseHttps(raw.trim());
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  return host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.startsWith("/maps")) || host === "g.co";
}

function parseHttps(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** google.com, google.co.in, maps.google.com and the like. */
function isGoogleHost(host: string): boolean {
  return /^([a-z0-9-]+\.)*google\.(com|co\.[a-z]{2}|[a-z]{2,3})$/.test(host);
}

function isFullMapsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!isGoogleHost(host)) return false;
  return host.startsWith("maps.") || url.pathname.startsWith("/maps");
}

function mayFetch(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (isShortMapsLink(url.href) || isGoogleHost(host));
}

export async function expandShortLink(
  raw: string,
  doFetch: (r: Request) => Promise<Response>,
): Promise<string | null> {
  let url = parseHttps(raw.trim());
  if (!url) return null;
  if (url.protocol === "http:") url.protocol = "https:";

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (isFullMapsUrl(url)) return url.href;
    // Google's cookie wall carries the real destination in `continue`.
    if (url.hostname.toLowerCase() === "consent.google.com") {
      const next = parseHttps(url.searchParams.get("continue") ?? "");
      if (!next) return null;
      url = next;
      continue;
    }
    if (!mayFetch(url)) return null;

    let res: Response;
    try {
      res = await doFetch(new Request(url.href, { method: "GET", redirect: "manual" }));
    } catch {
      return null;
    }
    // Drain nothing: the body is never read.
    await res.body?.cancel();
    const location = res.headers.get("Location");
    if (res.status < 300 || res.status >= 400 || !location) return null;
    try {
      url = new URL(location, url);
    } catch {
      return null;
    }
  }
  return isFullMapsUrl(url) ? url.href : null;
}
