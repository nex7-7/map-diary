import type { DeviceKind } from "@map-diary/sync";

/** The bridge the Capacitor Android shell injects into the page it wraps. */
interface CapacitorBridge {
  getPlatform?: () => string;
}

/**
 * What this device registers as. The Android app is the same site inside a Capacitor
 * shell, so it is told apart by the bridge Capacitor injects; everything else is `web`.
 * The Claude connector registers itself on the server side and never runs this.
 */
export function currentDeviceKind(scope: { Capacitor?: CapacitorBridge } = globalThis as { Capacitor?: CapacitorBridge }): DeviceKind {
  return scope.Capacitor?.getPlatform?.() === "android" ? "android" : "web";
}
