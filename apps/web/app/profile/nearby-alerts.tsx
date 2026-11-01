"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IconTile, accountStyles as s } from "@/app/_account/parts";
import { proximity, type PermissionState, type ProximityStatus } from "@/lib/android/bridge";
import { clampSettings, formatMinutes, parseMinutes, type AlertSettings } from "@/lib/android/proximity";
import { Button } from "@/lib/ui";

/**
 * Nearby alerts, on the You tab in the Android app only: the phone settings the alerts need
 * (each with a button that opens it) and when an alert goes off.
 */
export function NearbyAlerts() {
  const plugin = proximity();
  const [status, setStatus] = useState<ProximityStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!plugin) return;
    const load = () => void plugin.getStatus().then(setStatus, () => setFailed(true));
    load();
    // Coming back from a system settings screen is the only way these change.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [plugin]);

  if (!plugin) return null;
  if (failed) return <p className="sub">This version of the app has no nearby alerts. Install the latest one.</p>;
  if (!status) return <p className="sub">Loading…</p>;

  const run = (step: Promise<ProximityStatus | void>) =>
    void step.then((next) => next && setStatus(next), () => void plugin.getStatus().then(setStatus, () => undefined));
  const granted = (p: PermissionState) => p === "granted";
  const ready = granted(status.location) && granted(status.background) && granted(status.notifications);

  return (
    <div className="grid gap-6">
      <section className={s.sec}>
        <h2 className="kicker">Phone settings</h2>
        <ul className={s.list}>
          <Step
            done={granted(status.location)}
            title="Location"
            sub="Precise location, used only on this phone."
            action="Allow"
            onAction={() => run(status.location === "denied" ? plugin.openAppSettings() : plugin.requestLocation())}
          />
          <Step
            done={granted(status.background)}
            title="Allow all the time"
            sub="So alerts work while the app is closed. Pick “Allow all the time”."
            action="Open"
            disabled={!granted(status.location)}
            onAction={() => run(plugin.requestBackgroundLocation())}
          />
          <Step
            done={granted(status.notifications)}
            title="Notifications"
            sub="How the alert reaches you."
            action="Allow"
            onAction={() => run(status.notifications === "denied" ? plugin.openAppSettings() : plugin.requestNotifications())}
          />
          <Step
            done={status.batteryUnrestricted}
            title="Battery: no restrictions"
            sub="Nothing OS can otherwise stop the alerts in the background."
            action="Open"
            onAction={() => run(plugin.openBatterySettings())}
          />
        </ul>
        <p className="sub" style={{ margin: 0 }}>
          {!status.settings.enabled
            ? "Alerts are off."
            : ready
              ? `Watching the nearest ${status.watching} of your ${status.placeCount} Want to places.`
              : `${status.placeCount} Want to places are ready. Finish the settings above to start the alerts.`}
        </p>
      </section>
      <SettingsForm settings={status.settings} onSave={(settings) => run(plugin.setSettings({ settings }))} />
    </div>
  );
}

function Step({ done, title, sub, action, disabled, onAction }: { done: boolean; title: string; sub: string; action: string; disabled?: boolean; onAction: () => void }) {
  return (
    <li className={s.row}>
      <IconTile name={done ? "check" : "alert"} />
      <span className={s.rowText}>
        <span className={s.name}>{title}</span>
        <span className="sub">{sub}</span>
      </span>
      {!done && (
        <Button variant="secondary" size="m" disabled={disabled} onClick={onAction}>
          {action}
        </Button>
      )}
    </li>
  );
}

function SettingsForm({ settings, onSave }: { settings: AlertSettings; onSave: (s: AlertSettings) => void }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [radius, setRadius] = useState(String(settings.radiusM));
  const [dwell, setDwell] = useState(String(Math.round(settings.dwellSeconds / 60)));
  const [cooldown, setCooldown] = useState(String(settings.cooldownDays));
  const [quietFrom, setQuietFrom] = useState(formatMinutes(settings.quietStartMin));
  const [quietTo, setQuietTo] = useState(formatMinutes(settings.quietEndMin));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const start = parseMinutes(quietFrom);
    const end = parseMinutes(quietTo);
    if (start === null || end === null) return setError("Quiet hours need times like 23:00.");
    setError(null);
    onSave(
      clampSettings({
        enabled,
        radiusM: Number(radius),
        dwellSeconds: Number(dwell) * 60,
        cooldownDays: Number(cooldown),
        quietStartMin: start,
        quietEndMin: end,
      }),
    );
  };

  return (
    <form className={s.sec} onSubmit={submit}>
      <h2 className="kicker">When to alert</h2>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Alert me near a Want to place</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={s.field}>
          <span className={s.label}>Within (metres)</span>
          <input className={s.input} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </label>
        <label className={s.field}>
          <span className={s.label}>After (minutes)</span>
          <input className={s.input} inputMode="numeric" value={dwell} onChange={(e) => setDwell(e.target.value)} />
        </label>
        <label className={s.field}>
          <span className={s.label}>Quiet from</span>
          <input className={s.input} type="time" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
        </label>
        <label className={s.field}>
          <span className={s.label}>Quiet until</span>
          <input className={s.input} type="time" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
        </label>
        <label className={s.field}>
          <span className={s.label}>Same place again after (days)</span>
          <input className={s.input} inputMode="numeric" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
        </label>
      </div>
      {error && <p className={s.error}>{error}</p>}
      <div>
        <Button type="submit" size="m">
          Save
        </Button>
      </div>
    </form>
  );
}
