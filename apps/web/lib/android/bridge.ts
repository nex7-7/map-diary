import { registerPlugin } from "@capacitor/core";
import { currentDeviceKind } from "../device/kind";
import type { AlertPlace, AlertSettings } from "./proximity";

export type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** What the phone reports about nearby alerts. */
export interface ProximityStatus {
  /** Precise location while the app is open. */
  location: PermissionState;
  /** "Allow all the time", which geofencing needs while the app is closed. */
  background: PermissionState;
  notifications: PermissionState;
  /** The app is excluded from battery optimisation, so Nothing OS does not stop the alerts. */
  batteryUnrestricted: boolean;
  settings: AlertSettings;
  /** Want to places the phone holds, and how many of them it is watching right now. */
  placeCount: number;
  watching: number;
}

/** The Kotlin plugin in apps/android (`ProximityPlugin`). */
interface ProximityPlugin {
  getStatus(): Promise<ProximityStatus>;
  setPlaces(options: { places: AlertPlace[] }): Promise<ProximityStatus>;
  setSettings(options: { settings: AlertSettings }): Promise<ProximityStatus>;
  requestLocation(): Promise<ProximityStatus>;
  requestBackgroundLocation(): Promise<ProximityStatus>;
  requestNotifications(): Promise<ProximityStatus>;
  openBatterySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
}

const Proximity = registerPlugin<ProximityPlugin>("Proximity");

/** The geofencing plugin when this page runs inside the Android app, else null. */
export function proximity(): ProximityPlugin | null {
  return currentDeviceKind() === "android" ? Proximity : null;
}
