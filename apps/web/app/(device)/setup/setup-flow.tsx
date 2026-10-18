"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PASSPHRASE_MIN_LENGTH, prepareSetup, type PreparedSetup } from "@map-diary/sync";
import { adoptDevice, api, currentDeviceKind, useSession } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { errorMessage } from "../messages";
import { InstallWarning } from "../install-warning";

type Step = { name: "choose" } | { name: "phrase"; setup: PreparedSetup };

export function SetupFlow() {
  const session = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: "choose" });
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [noted, setNoted] = useState(false);
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

  async function choose(e: FormEvent) {
    e.preventDefault();
    if (passphrase !== confirm) {
      setError("The two passphrases don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setStep({ name: "phrase", setup: await prepareSetup({ passphrase, kind: currentDeviceKind() }) });
      // Nothing else needs the passphrase; drop it from the form.
      setPassphrase("");
      setConfirm("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function finish(setup: PreparedSetup) {
    setBusy(true);
    setError(null);
    try {
      await adoptDevice(await setup.complete(api));
      router.push("/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (step.name === "phrase") {
    return (
      <div className={styles.card}>
        <p>
          This is your <strong>recovery phrase</strong>. If you ever forget your passphrase, it is the only way back
          into your diary. Write it down on paper and keep it somewhere safe. It will not be shown again.
        </p>
        <div className={styles.phrase} aria-label="Recovery phrase">
          {step.setup.recoveryPhrase.split("-").map((group, i) => (
            <span key={i}>{group}</span>
          ))}
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={noted} onChange={(e) => setNoted(e.target.checked)} />
          <span>I&apos;ve written it down</span>
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.button} disabled={!noted || busy} onClick={() => void finish(step.setup)}>
          {busy ? "Setting up…" : "Finish setup"}
        </button>
      </div>
    );
  }

  return (
    <form className={styles.card} onSubmit={(e) => void choose(e)}>
      <InstallWarning />
      <p>
        Choose a passphrase. You&apos;ll use it to sign in on your other devices. Everything is encrypted on this
        device, so nobody, including the server, can reset it for you.
      </p>
      <label className={styles.field}>
        <span>Passphrase</span>
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
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Making your keys…" : "Continue"}
      </button>
      <Link className="muted" href="/sign-in">
        Already set up on another device? Sign in
      </Link>
    </form>
  );
}
