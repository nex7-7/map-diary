"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PairingError, type OpenPairing, type PairingCheck } from "@map-diary/sync";
import entries from "@/app/_entries/entries.module.css";
import { PASSPHRASE_MIN_LENGTH } from "@map-diary/sync";
import { errorMessage, pairingErrorMessage, revokeErrorMessage } from "@/app/(device)/messages";
import {
  DeviceGate,
  addDevice,
  choosePassphrase,
  listDevices,
  removeDevice,
  type AccountOverview,
  type Diary,
  type ListedDevice,
} from "@/lib/device";
import styles from "@/lib/device/device.module.css";

const POLL_MS = 2000;

const KIND_LABEL: Record<string, string> = { web: "Browser", android: "Android app", claude: "Claude" };

/** `/devices`: the devices signed in to this account, and linking a new one. */
export function DevicesPage() {
  return (
    <main>
      <Link href="/" className={entries.back}>
        ← Diary
      </Link>
      <h1 style={{ margin: "12px 0 16px" }}>Devices</h1>
      <DeviceGate>{(diary) => <Devices diary={diary} />}</DeviceGate>
    </main>
  );
}

function Devices({ diary }: { diary: Diary }) {
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const devices = overview?.devices ?? (overview === null ? null : []);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    listDevices(diary).then(
      (o) => {
        setOverview(o);
        setLoadFailed(false);
      },
      () => {
        setOverview((o) => o ?? { devices: [], isAdmin: false, hasPassphrase: true });
        setLoadFailed(true);
      },
    );
  }, [diary]);
  useEffect(load, [load]);

  const day = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className={styles.card}>
      {loadFailed && <p className={styles.error}>Couldn&apos;t load your devices. Check your connection and reload.</p>}
      {devices === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {devices.map((d) => (
            <li key={d.id}>
              <strong>{KIND_LABEL[d.kind] ?? d.kind}</strong>
              {d.current && " (this device)"}
              <br />
              <span className="muted">
                Added {day(d.createdAt)}
                {d.lastSeenAt !== null && ` · last used ${day(d.lastSeenAt)}`}
              </span>
              {!d.current &&
                (removing === d.id ? (
                  <RemoveDevice
                    diary={diary}
                    device={d}
                    onDone={() => {
                      setRemoving(null);
                      load();
                    }}
                  />
                ) : (
                  <button className={styles.secondary} type="button" onClick={() => setRemoving(d.id)}>
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddDevice
          diary={diary}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      ) : (
        <button className={styles.button} type="button" onClick={() => setAdding(true)}>
          Add a device
        </button>
      )}
      {overview && !loadFailed && <Passphrase diary={diary} hasPassphrase={overview.hasPassphrase} onDone={load} />}
      {overview?.isAdmin && (
        <Link className="muted" href="/admin">
          Invites and members
        </Link>
      )}
    </div>
  );
}

/**
 * Sets or changes the passphrase used to sign in without another device. The recovery phrase
 * proves it is you, because this device does not keep the seed the backup is made from.
 */
function Passphrase({ diary, hasPassphrase, onDone }: { diary: Diary; hasPassphrase: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function close() {
    setOpen(false);
    setPhrase("");
    setPassphrase("");
    setConfirm("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (passphrase !== confirm) {
      setError("The two passphrases don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await choosePassphrase(diary, phrase, passphrase);
      close();
      setSaved(true);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        {saved && <p>Passphrase saved. You can use it to sign in on a new device.</p>}
        {!hasPassphrase && !saved && (
          <p className="muted">
            You haven&apos;t set a passphrase. Without one, a new device can only sign in with this one nearby or with
            your recovery phrase.
          </p>
        )}
        <button className={styles.secondary} type="button" onClick={() => setOpen(true)}>
          {hasPassphrase || saved ? "Change passphrase" : "Set a passphrase"}
        </button>
      </>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 12 }}>
      <label className={styles.field}>
        <span>Your recovery phrase</span>
        <textarea
          rows={2}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          required
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span>New passphrase</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={PASSPHRASE_MIN_LENGTH}
          required
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <span className="muted">At least {PASSPHRASE_MIN_LENGTH} characters. A short sentence works well.</span>
      </label>
      <label className={styles.field}>
        <span>Type it again</span>
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save passphrase"}
      </button>
      <button className={styles.secondary} type="button" disabled={busy} onClick={close}>
        Cancel
      </button>
    </form>
  );
}

/** Shows a QR code and a typed code for the new device, then asks to confirm its code. */
function AddDevice({ diary, onDone }: { diary: Diary; onDone: () => void }) {
  const [pairing, setPairing] = useState<OpenPairing | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [seen, setSeen] = useState<PairingCheck>({ state: "waiting" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let opened: OpenPairing | null = null;
    setError(null);
    setSeen({ state: "waiting" });
    addDevice(diary).then(
      async (p) => {
        opened = p;
        if (!live) return void p.cancel();
        setPairing(p);
        setQr(await QRCode.toDataURL(p.link, { margin: 1, width: 240 }));
      },
      (err: unknown) => live && setError(pairingErrorMessage(err)),
    );
    return () => {
      live = false;
      void opened?.cancel();
    };
  }, [diary, attempt]);

  // Poll until the new device joins; stop once it has, so the code stays put while the person compares.
  useEffect(() => {
    if (!pairing || seen.state !== "waiting") return;
    const timer = setInterval(() => {
      if (Date.now() > pairing.expiresAt) {
        clearInterval(timer);
        setError(pairingErrorMessage(new PairingError("expired")));
        return;
      }
      pairing.check().then(setSeen, (err: unknown) => {
        clearInterval(timer);
        setError(pairingErrorMessage(err));
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pairing, seen.state]);

  async function approve() {
    if (!pairing) return;
    setBusy(true);
    try {
      await pairing.approve();
      onDone();
    } catch (err) {
      setError(pairingErrorMessage(err));
      setBusy(false);
    }
  }

  async function cancel() {
    await pairing?.cancel();
    onDone();
  }

  if (error) {
    return (
      <>
        <p className={styles.error}>{error}</p>
        <button className={styles.button} type="button" onClick={() => setAttempt((n) => n + 1)}>
          Make a new code
        </button>
        <button className={styles.secondary} type="button" onClick={() => void cancel()}>
          Close
        </button>
      </>
    );
  }

  if (seen.state === "joined") {
    return (
      <>
        <p>
          A new {KIND_LABEL[seen.kind]?.toLowerCase() ?? "device"} wants to join. Add it only if it shows this code:
        </p>
        <p className={styles.code} aria-label="Confirmation code">
          {seen.code}
        </p>
        <button className={styles.button} type="button" disabled={busy} onClick={() => void approve()}>
          {busy ? "Adding…" : "The codes match, add it"}
        </button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => void cancel()}>
          They don&apos;t match
        </button>
      </>
    );
  }

  return (
    <>
      <p>On the new device, scan this with the camera, or open the diary, tap Sign in, choose Another device and type the code.</p>
      {qr ? <img src={qr} alt="QR code to add a device" width={240} height={240} /> : <p className="muted">Making a code…</p>}
      {pairing && <p className={styles.code}>{pairing.secret}</p>}
      <p className="muted">The code works once, for ten minutes.</p>
      <button className={styles.secondary} type="button" onClick={() => void cancel()}>
        Cancel
      </button>
    </>
  );
}

/**
 * Confirms removing a device. The passphrase or recovery phrase is needed because this device
 * moves the account to new keys derived from it, which the removed device cannot follow.
 */
function RemoveDevice({ diary, device, onDone }: { diary: Diary; device: ListedDevice; onDone: () => void }) {
  const [mode, setMode] = useState<"passphrase" | "phrase">("passphrase");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (KIND_LABEL[device.kind] ?? device.kind).toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await removeDevice(diary, device.id, mode === "passphrase" ? { passphrase: value } : { recoveryPhrase: value });
      setValue("");
      onDone();
    } catch (err) {
      setError(revokeErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 12, marginTop: 12 }}>
      <p>
        Removing this {name} signs it out at once, and your diary moves to new keys so it can&apos;t read anything
        new. Use this for a lost or old device.
      </p>
      <div className={styles.tabs} role="group" aria-label="Confirm with">
        <button
          type="button"
          className={styles.button}
          aria-pressed={mode === "passphrase"}
          onClick={() => {
            setMode("passphrase");
            setValue("");
          }}
        >
          Passphrase
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={mode === "phrase"}
          onClick={() => {
            setMode("phrase");
            setValue("");
          }}
        >
          Recovery phrase
        </button>
      </div>
      <label className={styles.field}>
        <span>{mode === "passphrase" ? "Your passphrase" : "Your recovery phrase"}</span>
        {mode === "passphrase" ? (
          <input
            type="password"
            autoComplete="current-password"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <textarea
            rows={2}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy || value.length === 0}>
        {busy ? "Removing…" : `Remove this ${name}`}
      </button>
      <button className={styles.secondary} type="button" disabled={busy} onClick={onDone}>
        Keep it
      </button>
    </form>
  );
}
