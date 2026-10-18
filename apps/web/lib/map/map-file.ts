/**
 * The Mumbai map file, kept whole on the device.
 *
 * It is downloaded once in full and then read only from Cache Storage, so the
 * server never sees which tiles are on screen. Range requests are used only to
 * resume an interrupted download.
 */

export const MAP_FILE_URL = process.env.NEXT_PUBLIC_MAP_FILE_URL || "/api/tiles/mumbai.pmtiles";

const CACHE_NAME = "map-file-v1";
const MAX_ATTEMPTS = 4;

export type Progress = (loaded: number, total: number | undefined) => void;

export async function loadMapFile(onProgress?: Progress, signal?: AbortSignal): Promise<File> {
  const cache = await openCache();
  const cached = await cache?.match(MAP_FILE_URL);
  if (cached) return toFile(await cached.blob());

  const blob = await download(onProgress, signal);
  await assertPmtiles(blob);
  try {
    await cache?.put(MAP_FILE_URL, new Response(blob, { headers: { "content-type": "application/vnd.pmtiles" } }));
    // Ask the browser not to evict it (and the rest of the app's storage).
    await navigator.storage?.persist?.();
  } catch {
    // Quota or private mode: the map still works for this visit.
  }
  return toFile(blob);
}

/** Drops the stored copy, so the next load downloads a fresh one. */
export async function forgetMapFile(): Promise<void> {
  if (typeof caches !== "undefined") await caches.delete(CACHE_NAME);
}

async function openCache(): Promise<Cache | undefined> {
  // Cache Storage needs a secure context (https or localhost).
  if (typeof caches === "undefined") return undefined;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return undefined;
  }
}

async function download(onProgress: Progress | undefined, signal: AbortSignal | undefined): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  let total: number | undefined;

  for (let attempt = 1; ; attempt++) {
    try {
      const headers: HeadersInit = loaded > 0 ? { range: `bytes=${loaded}-` } : {};
      const res = await fetch(MAP_FILE_URL, { headers, signal: signal ?? null, cache: "no-store" });
      if (loaded > 0 && res.status !== 206) {
        // The server ignored the range; start over.
        chunks.length = 0;
        loaded = 0;
      }
      if (!res.ok || !res.body) throw new MapFileError(`Map file request failed (${res.status})`);
      total ??= totalSize(res, loaded);

      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
      if (total === undefined || loaded >= total) return new Blob(chunks, { type: "application/vnd.pmtiles" });
    } catch (err) {
      if (signal?.aborted || err instanceof MapFileError || attempt >= MAX_ATTEMPTS) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
  }
}

function totalSize(res: Response, offset: number): number | undefined {
  const range = res.headers.get("content-range")?.match(/\/(\d+)$/);
  if (range) return Number(range[1]);
  const length = Number(res.headers.get("content-length"));
  return Number.isFinite(length) && length > 0 ? length + offset : undefined;
}

async function assertPmtiles(blob: Blob): Promise<void> {
  const magic = new TextDecoder().decode(await blob.slice(0, 7).arrayBuffer());
  if (magic !== "PMTiles") throw new MapFileError("The downloaded map file is not a PMTiles archive");
}

function toFile(blob: Blob): File {
  // FileSource keys tiles by file name; the style refers to it as pmtiles://mumbai.pmtiles.
  return new File([blob], MAP_FILE_NAME, { type: "application/vnd.pmtiles" });
}

export const MAP_FILE_NAME = "mumbai.pmtiles";

export class MapFileError extends Error {
  override name = "MapFileError";
}
