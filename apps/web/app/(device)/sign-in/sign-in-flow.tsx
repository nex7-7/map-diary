"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PASSPHRASE_MIN_LENGTH, signInWithPassphrase, signInWithRecoveryPhrase } from "@map-diary/sync";
import { adoptDevice, api, currentDeviceKind, useSession } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { errorMessage } from "../messages";
import { InstallWarning } from "../install-warning";

type Mode = "passphrase" | "recovery";

export function SignInFlow() {
  const session = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session.state === "ready") {
    return (
      <div className={styles.card}>
        <p>This device is already signed in.</p>
        <Link className={styles.button} href="/">
          Open the diary
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "recovery" && newPassphrase !== confirm) {
      setError("The two passphrases don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const device =
        mode === "passphrase"
          ? await signInWithPassphrase(api, passphrase, currentDeviceKind())
          : await signInWithRecoveryPhrase(api, { recoveryPhrase: phrase, newPassphrase, kind: currentDeviceKind() });
      await adoptDevice(device);
      router.push("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
  }

  return (
    <form className={styles.card} onSubmit={(e) => void submit(e)}>
      <InstallWarning />
      <div className={styles.tabs} role="group" aria-label="Sign in with">
        <button
          type="button"
          className={styles.button}
          aria-pressed={mode === "passphrase"}
          onClick={() => switchTo("passphrase")}
        >
          Passphrase
        </button>
        <button
          type="button"
          className={styles.button}
          aria-pressed={mode === "recovery"}
          onClick={() => switchTo("recovery")}
        >
          Recovery phrase
        </button>
      </div>

      {mode === "passphrase" ? (
        <label className={styles.field}>
          <span>Passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
      ) : (
        <>
          <p className="muted">Forgot your passphrase? Enter the recovery phrase you wrote down, then choose a new one.</p>
          <label className={styles.field}>
            <span>Recovery phrase</span>
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
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
            />
            <span className="muted">At least {PASSPHRASE_MIN_LENGTH} characters. Your old passphrase stops working.</span>
          </label>
          <label className={styles.field}>
            <span>Type it again</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <Link className="muted" href="/setup">
        First time here? Set up the diary
      </Link>
    </form>
  );
}
