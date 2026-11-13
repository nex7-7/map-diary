"use client";

import { useEffect, useState, type ReactNode } from "react";
import { accountStyles as s } from "@/app/_account/parts";
import { proximity, type PermissionState, type ProximityStatus } from "@/lib/android/bridge";
import { clampSettings, formatMinutes, parseMinutes, type AlertSettings } from "@/lib/android/proximity";
import { Button, Icon } from "@/lib/ui";

/**
 * Nearby alerts, on the You tab in the Android app only: the phone settings the alerts need
 * (each with a button that opens it) and when an alert goes off.
 */
export function NearbyAlerts() {
  const plugin = proximity();
  return plugin ? <NearbyPanel plugin={plugin} /> : null;
}

/** The panel itself, given the plugin (a stand-in one in previews). */
export function NearbyPanel({ plugin }: { plugin: NonNullable<ReturnType<typeof proximity>> }) {
  const [status, setStatus] = useState<ProximityStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () => void plugin.getStatus().then(setStatus, () => setFailed(true));
    load();
    // Coming back from a system settings screen is the only way these change.
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [plugin]);

  if (failed) return <p className="sub">This version of the app has no nearby alerts. Install the latest one.</p>;
  if (!status) return <p className="sub">Loading…</p>;

  const run = (step: Promise<ProximityStatus | void>) =>
    void step.then((next) => next && setStatus(next), () => void plugin.getStatus().then(setStatus, () => undefined));
  const granted = (p: PermissionState) => p === "granted";
  const ready = granted(status.location) && granted(status.background) && granted(status.notifications);
  const steps = [
    {
      done: granted(status.location),
      title: "Location",
      sub: "Precise, used only on this phone",
      action: "Allow",
      onAction: () => run(status.location === "denied" ? plugin.openAppSettings() : plugin.requestLocation()),
    },
    {
      done: granted(status.background),
      title: "Allow all the time",
      sub: "So alerts work with the app closed. Pick “Allow all the time”.",
      action: "Open",
      disabled: !granted(status.location),
      onAction: () => run(plugin.requestBackgroundLocation()),
    },
    {
      done: granted(status.notifications),
      title: "Notifications",
      sub: "How the alert reaches you",
      action: "Allow",
      onAction: () => run(status.notifications === "denied" ? plugin.openAppSettings() : plugin.requestNotifications()),
    },
    {
      done: status.batteryUnrestricted,
      title: "Battery: no restrictions",
      sub: "Nothing OS can stop alerts otherwise",
      action: "Open",
      onAction: () => run(plugin.openBatterySettings()),
    },
  ];
  const done = steps.filter((x) => x.done).length;
  const left = steps.length - done;
  // The first step still to do gets the red button; the rest wait their turn.
  const next = steps.findIndex((x) => !x.done && !x.disabled);
  const watching = status.settings.enabled && ready;

  return (
    <div className="grid gap-5">
      <section className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-ink bg-page p-4 shadow-[0_3px_0_rgb(32_31_27/0.15)]">
        <div className="flex items-center gap-3">
          <span className={`seal ${watching ? "" : "opacity-70"} size-[54px] shrink-0 [transform:rotate(-8deg)]`} aria-hidden="true">
            <span className="flex flex-col items-center gap-0.5 text-[9px]">
              <span className="font-worn text-[17px]">{watching ? status.watching : status.placeCount}</span>
              near
            </span>
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-bold">{!status.settings.enabled ? "Alerts are off" : watching ? `Watching ${status.watching} places` : "Not watching yet"}</span>
            <span className="text-[13px] leading-snug text-ink-2">
              {!status.settings.enabled
                ? `${status.placeCount} Want to places are ready. Turn alerts on below.`
                : watching
                  ? `The nearest ${status.watching} of your ${status.placeCount} Want to places.`
                  : `${status.placeCount} Want to places are ready. ${left === 1 ? "One phone setting is" : `${left} phone settings are`} left.`}
            </span>
          </div>
        </div>
        <p className="m-0 text-[13px] leading-normal text-ink-2">
          The phone nudges you when you linger near a place you want to go to. Where you are never leaves the phone.
        </p>
      </section>

      <section className={s.sec}>
        <h2 className="kicker">
          Phone settings · {done} of {steps.length} done
        </h2>
        <ol className="m-0 flex list-none flex-col p-0">
          {steps.map((x, i) => (
            <Step key={x.title} n={i + 1} {...x} primary={i === next} />
          ))}
        </ol>
      </section>
      <SettingsForm settings={status.settings} onSave={(settings) => run(plugin.setSettings({ settings }))} />
    </div>
  );
}

interface StepProps {
  n: number;
  done: boolean;
  title: string;
  sub: string;
  action: string;
  disabled?: boolean;
  primary: boolean;
  onAction: () => void;
}

/** One phone setting: a red seal once done, its number in a slot until then. */
function Step({ n, done, title, sub, action, disabled, primary, onAction }: StepProps) {
  return (
    <li className="flex items-center gap-3 border-b border-dashed border-rule-ink py-3 last:border-b-0">
      {done ? (
        <span className="seal solid grid size-[30px] shrink-0 place-items-center" aria-label="Done">
          <span className="grid text-cream">
            <Icon name="check" size="s" />
          </span>
        </span>
      ) : (
        <span className={`slot size-[30px] shrink-0 text-[13px] font-bold ${primary ? "border-seal text-seal" : ""}`} aria-label={`Step ${n}`}>
          {n}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14.5px] font-semibold">{title}</span>
        <span className="text-[12.5px] text-ink-2">{sub}</span>
      </span>
      {!done && (
        <Button variant={primary ? "primary" : "secondary"} size="m" disabled={disabled} onClick={onAction}>
          {action}
        </Button>
      )}
    </li>
  );
}

/** Changes save as they are made. */
function SettingsForm({ settings, onSave }: { settings: AlertSettings; onSave: (s: AlertSettings) => void }) {
  const [current, setCurrent] = useState(settings);
  const [quietFrom, setQuietFrom] = useState(formatMinutes(settings.quietStartMin));
  const [quietTo, setQuietTo] = useState(formatMinutes(settings.quietEndMin));
  const [error, setError] = useState<string | null>(null);

  const save = (patch: Partial<AlertSettings>) => {
    const next = clampSettings({ ...current, ...patch });
    setCurrent(next);
    onSave(next);
  };
  const saveQuiet = (from: string, to: string) => {
    const start = parseMinutes(from);
    const end = parseMinutes(to);
    if (start === null || end === null) return setError("Quiet hours need times like 23:00.");
    setError(null);
    save({ quietStartMin: start, quietEndMin: end });
  };
  const minutes = Math.round(current.dwellSeconds / 60);

  return (
    <section className={s.sec}>
      <h2 className="kicker">When to alert</h2>
      <div className="flex flex-col">
        <Row title="Alert me near a Want to place">
          <button
            type="button"
            role="switch"
            aria-checked={current.enabled}
            aria-label="Alert me near a Want to place"
            onClick={() => save({ enabled: !current.enabled })}
            className={`relative h-8 w-14 shrink-0 rounded-full border-[1.8px] border-ink p-0 transition-colors ${current.enabled ? "bg-seal" : "bg-paper-deep"}`}
          >
            <span className={`absolute top-[3px] size-[22px] rounded-full border-[1.5px] border-ink bg-page transition-[left] ${current.enabled ? "left-[27px]" : "left-[3px]"}`} />
          </button>
        </Row>
        <Row title="Within" sub="of the place">
          <Stepper label="Distance" value={`${current.radiusM} m`} onLess={() => save({ radiusM: current.radiusM - 50 })} onMore={() => save({ radiusM: current.radiusM + 50 })} />
        </Row>
        <Row title="After" sub="of lingering">
          <Stepper
            label="Time"
            value={minutes === 0 ? "at once" : `${minutes} min`}
            onLess={() => save({ dwellSeconds: (minutes - 1) * 60 })}
            onMore={() => save({ dwellSeconds: (minutes + 1) * 60 })}
          />
        </Row>
        <Row title="Same place again" sub="after">
          <Stepper
            label="Days"
            value={`${current.cooldownDays} ${current.cooldownDays === 1 ? "day" : "days"}`}
            onLess={() => save({ cooldownDays: current.cooldownDays - 1 })}
            onMore={() => save({ cooldownDays: current.cooldownDays + 1 })}
          />
        </Row>
        <Row title="Quiet hours" sub="no alerts" last>
          <span className="flex items-center gap-1.5">
            <input
              type="time"
              aria-label="Quiet from"
              className="chip h-9 w-[104px] justify-center px-2 text-[13.5px] tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
              value={quietFrom}
              onChange={(e) => setQuietFrom(e.target.value)}
              onBlur={() => saveQuiet(quietFrom, quietTo)}
            />
            <span className="text-ink-2">to</span>
            <input
              type="time"
              aria-label="Quiet until"
              className="chip h-9 w-[104px] justify-center px-2 text-[13.5px] tabular-nums [&::-webkit-calendar-picker-indicator]:hidden"
              value={quietTo}
              onChange={(e) => setQuietTo(e.target.value)}
              onBlur={() => saveQuiet(quietFrom, quietTo)}
            />
          </span>
        </Row>
      </div>
      {error && <p className={s.error}>{error}</p>}
      <p className="m-0 text-[12.5px] text-ink-2">Changes save as you make them.</p>
    </section>
  );
}

function Row({ title, sub, last, children }: { title: string; sub?: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={`flex min-h-14 items-center justify-between gap-3 py-2 ${last ? "" : "border-b border-dashed border-rule-ink"}`}>
      <span className="flex flex-col">
        <span className="text-[14.5px] font-semibold">{title}</span>
        {sub && <span className="text-[12px] text-ink-2">{sub}</span>}
      </span>
      {children}
    </div>
  );
}

/** − value +, for a number with its unit. */
function Stepper({ label, value, onLess, onMore }: { label: string; value: string; onLess: () => void; onMore: () => void }) {
  return (
    <span className="flex shrink-0 items-center overflow-hidden rounded-xl border-[1.5px] border-ink bg-page">
      <button type="button" className="grid size-10 place-items-center border-0 bg-transparent text-[18px]" aria-label={`${label}: less`} onClick={onLess}>
        −
      </button>
      <span className="min-w-[64px] text-center text-[14px] font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className="grid size-10 place-items-center border-0 bg-transparent text-[18px]" aria-label={`${label}: more`} onClick={onMore}>
        +
      </button>
    </span>
  );
}
