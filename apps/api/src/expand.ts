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

/** A Zomato share link (zomato.onelink.me), which opens the app rather than a web page. */
export function isZomatoOnelink(raw: string): boolean {
  const url = parseHttps(raw.trim());
  return url !== null && url.hostname.toLowerCase() === "zomato.onelink.me";
}

/** What a crawler is shown: Zomato answers it with the restaurant's name in the redirect. */
const PREVIEW_AGENT = "facebookexternalhit/1.1";

/**
 * The restaurant's name behind a Zomato share link. The link itself only holds a token that
 * the Zomato app turns into a restaurant; a browser lands on the "install the app" page. Asked
 * the way a link preview is, Zomato redirects once with the name in `af_og_title`. That gives
 * the name, not which branch, so the resolver searches it like a plain name. One request to
 * zomato.onelink.me only; the redirect is read, never followed, and no body is read.
 */
export async function onelinkName(raw: string, doFetch: (r: Request) => Promise<Response>): Promise<string | null> {
  if (!isZomatoOnelink(raw)) return null;
  const url = parseHttps(raw.trim())!;
  url.protocol = "https:";
  let res: Response;
  try {
    res = await doFetch(new Request(url.href, { method: "GET", redirect: "manual", headers: { "User-Agent": PREVIEW_AGENT } }));
  } catch {
    return null;
  }
  await res.body?.cancel();
  const location = res.headers.get("Location");
  if (res.status < 300 || res.status >= 400 || !location) return null;
  let next: URL;
  try {
    next = new URL(location, url);
  } catch {
    return null;
  }
  const name = (next.searchParams.get("af_og_title") ?? "").replace(/\s+/g, " ").trim();
  return name && name.length <= 200 ? name : null;
}
