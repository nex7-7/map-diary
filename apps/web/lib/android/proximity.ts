import { MUMBAI_BOUNDS } from "@map-diary/crypto";
import { EMPTY_FILTERS, filterPlaces } from "../places/filter";
import type { DiarySnapshot, LngLat } from "../places/types";

/**
 * Nearby alerts run only in the Android app: the page hands the native geofencing plugin the
 * names and pins of the owner's Want to places, which it keeps in app-private storage so alerts
 * work while the app is closed. Nothing about the person's location leaves the phone.
 */

/** One fence the phone watches: an outlet of a Want to place. */
export interface AlertPlace {
  /** The place (or chain outlet) id; tapping the alert opens `/place#<id>`. */
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface AlertSettings {
  enabled: boolean;
  /** How close counts as near, in metres. */
  radiusM: number;
  /** How long to stay near before the alert, in seconds. */
  dwellSeconds: number;
  /** Days before the same place can alert again. */
  cooldownDays: number;
  /** Quiet hours as minutes after local midnight; equal start and end means none. */
  quietStartMin: number;
  quietEndMin: number;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  radiusM: 200,
  dwellSeconds: 60,
  cooldownDays: 3,
  quietStartMin: 23 * 60,
  quietEndMin: 8 * 60,
};

/** Android tracks at most 100 fences per app: 99 places and the one that reloads them as you move. */
export const MAX_FENCES = 99;

const LIMITS = {
  radiusM: [100, 1000],
  dwellSeconds: [0, 600],
  cooldownDays: [1, 30],
} as const;

/** Settings brought inside the ranges the phone accepts, whole numbers only. */
export function clampSettings(s: AlertSettings): AlertSettings {
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : lo)));
  const minute = (v: number) => ((Math.round(Number.isFinite(v) ? v : 0) % 1440) + 1440) % 1440;
  return {
    enabled: s.enabled,
    radiusM: clamp(s.radiusM, LIMITS.radiusM),
    dwellSeconds: clamp(s.dwellSeconds, LIMITS.dwellSeconds),
    cooldownDays: clamp(s.cooldownDays, LIMITS.cooldownDays),
    quietStartMin: minute(s.quietStartMin),
    quietEndMin: minute(s.quietEndMin),
  };
}

function inMumbai({ lng, lat }: LngLat): boolean {
  const [west, south, east, north] = MUMBAI_BOUNDS;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

/**
 * Every outlet of every place on my own list as Want to. A chain alerts at each of its
 * outlets under its own name. Places outside Mumbai have no pin, so they never alert.
 */
export function alertPlaces(snapshot: DiarySnapshot, meId: string): AlertPlace[] {
  const out: AlertPlace[] = [];
  const seen = new Set<string>();
  for (const listed of filterPlaces(snapshot.places, EMPTY_FILTERS, meId)) {
    if (!listed.mine || listed.status !== "want") continue;
    const { place } = listed;
    for (const outlet of place.outlets ?? [place]) {
      if (seen.has(outlet.id) || !inMumbai(outlet.location)) continue;
      seen.add(outlet.id);
      out.push({ id: outlet.id, name: place.name, lat: outlet.location.lat, lng: outlet.location.lng });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** "23:00" for 1380. */
export function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 1380 for "23:00"; null for anything else. */
export function parseMinutes(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}
