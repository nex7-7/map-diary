import { addProtocol, getVersion, setWorkerUrl } from "maplibre-gl";
import { FileSource, PMTiles, Protocol } from "pmtiles";

let protocol: Protocol | undefined;

/**
 * Lets MapLibre read `pmtiles://<file name>` from a map file held on the device.
 * Safe to call more than once. Browser only.
 */
export function registerProtocol(file: File): void {
  if (!protocol) {
    // Copied into public/ by scripts/copy-maplibre-worker.mjs.
    setWorkerUrl(`/map/maplibre/${getVersion()}/maplibre-gl-worker.mjs`);
    protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
  }
  protocol.add(new PMTiles(new FileSource(file)));
}
