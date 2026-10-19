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

/**
 * Makes the account's keys and shows the recovery phrase. Without `inviteCode` this is the
 * admin's first-run setup and a passphrase is required; with one, a friend joins and the
 * passphrase is optional (they can set one later from the Devices screen).
 */
export function SetupFlow({ inviteCode }: { inviteCode?: string }) {
  const invited = inviteCode !== undefined;
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
      setStep({
        name: "phrase",
        setup: await prepareSetup({
          ...(passphrase ? { passphrase } : {}),
          ...(invited ? { inviteCode } : {}),
          kind: currentDeviceKind(),
        }),
      });
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
      // A friend who just joined picks their name and picture next.
      router.push(invited ? "/welcome" : "/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (step.name === "phrase") {
    return (
      <div className={styles.card}>
        <p>
          This is your <strong>recovery phrase</strong>. If you lose this device
          {invited ? " (or forget your passphrase, if you set one)" : " or forget your passphrase"}, it is the only way
          back into your diary. Write it down on paper and keep it somewhere safe. It will not be shown again.
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
      {invited ? (
        <p>
          You can choose a passphrase for signing in on a new phone without this one, or skip it and set one later.
          Everything is encrypted on this device, so nobody, including the server, can reset it for you.
        </p>
      ) : (
        <p>
          Choose a passphrase. You&apos;ll use it to sign in on your other devices. Everything is encrypted on this
          device, so nobody, including the server, can reset it for you.
        </p>
      )}
      <label className={styles.field}>
        <span>{invited ? "Passphrase (optional)" : "Passphrase"}</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={PASSPHRASE_MIN_LENGTH}
          required={!invited || confirm.length > 0}
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
          required={!invited || passphrase.length > 0}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "Making your keys…" : invited && !passphrase ? "Continue without a passphrase" : "Continue"}
      </button>
      <Link className="muted" href="/sign-in">
        Already set up on another device? Sign in
      </Link>
      {!invited && (
        <Link className="muted" href="/invite">
          Got an invite code? Enter it here
        </Link>
      )}
    </form>
  );
}
