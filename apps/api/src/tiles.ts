import { Hono } from "hono";
import { fail } from "./http";

/** Map files served from R2. Only the Mumbai file exists for now. */
const TILE_FILES = new Set(["mumbai.pmtiles"]);

export const tiles = new Hono<{ Bindings: Env }>();

/**
 * Public, unauthenticated: the map file holds no user data. Devices download it whole and
 * read it locally, so the server never learns which area anyone looks at; Range support
 * is only for resuming that download.
 */
tiles.on(["GET", "HEAD"], "/tiles/:file", async (c) => {
  const key = c.req.param("file");
  if (!TILE_FILES.has(key)) return fail(c, 404, "not_found");

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "Content-Type": "application/vnd.pmtiles",
  });

  if (c.req.method === "HEAD") {
    const head = await c.env.TILES.head(key);
    if (!head) return fail(c, 404, "not_found");
    headers.set("ETag", head.httpEtag);
    headers.set("Content-Length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const obj = await c.env.TILES.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) return fail(c, 404, "not_found");
  headers.set("ETag", obj.httpEtag);

  // A failed precondition: R2 returns metadata without a body.
  if (!("body" in obj)) return new Response(null, { status: 304, headers });

  const range = obj.range;
  if (range && c.req.header("Range")) {
    let offset: number;
    let length: number;
    // Local R2 sets every field, some undefined, so check values rather than keys.
    const r = range as { offset?: number; length?: number; suffix?: number };
    if (typeof r.suffix === "number") {
      length = Math.min(r.suffix, obj.size);
      offset = obj.size - length;
    } else {
      offset = r.offset ?? 0;
      length = r.length ?? obj.size - offset;
    }
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});
