"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { checkAppInvite, type InviteCheck } from "@map-diary/sync";
import { api, useSession } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { InstallWarning } from "../install-warning";
import { inviteErrorMessage, needsHomeScreenInstall } from "../messages";
import { SetupFlow } from "../setup/setup-flow";

const CHECK_MESSAGES: Record<Exclude<InviteCheck["state"], "open">, string> = {
  bad_code: "That invite code has a typo. It is twenty letters and digits, like 7K3QM-9XT2B-QW4RT-ZP0HK.",
  unknown: "That invite doesn't exist. It may have been cancelled; ask for a new one.",
  used: "That invite was already used. Each one works once; ask for a new one.",
  expired: "That invite has expired. Ask for a new one.",
};

/**
 * `/invite#CODE`: where an app invite link leads. The code never reaches the server. Without a
 * code in the link (or on an iPhone, where the link opened in Safari) the code is typed here.
 */
export function InviteFlow() {
  const session = useSession();
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [homeScreen, setHomeScreen] = useState(false);
  const [typed, setTyped] = useState("");
  const [accepted, setAccepted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLinkCode(decodeURIComponent(window.location.hash.slice(1)));
    setHomeScreen(needsHomeScreenInstall());
  }, []);

  async function check(code: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await checkAppInvite(api, code);
      if (result.state === "open") setAccepted(code);
      else setError(CHECK_MESSAGES[result.state]);
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // A code from the link is checked straight away, unless it must be typed into the installed app.
  useEffect(() => {
    if (linkCode && !homeScreen && session.state === "signed-out") void check(linkCode);
  }, [linkCode, homeScreen, session.state]);

  if (session.state === "loading" || linkCode === null) return <p className="muted">Opening…</p>;
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
  if (accepted) return <SetupFlow inviteCode={accepted} />;

  // A tapped link opens in Safari, whose storage is separate from the Home Screen app.
  if (homeScreen && linkCode) {
    return (
      <div className={styles.card}>
        <InstallWarning />
        <p>
          Once the diary is on your Home Screen, open it from there, tap <strong>Got an invite code?</strong> and type
          this code:
        </p>
        <p className={styles.code}>{linkCode}</p>
      </div>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void check(typed);
  }

  return (
    <form className={styles.card} onSubmit={submit}>
      <InstallWarning />
      {linkCode && busy ? (
        <p className="muted">Checking your invite…</p>
      ) : (
        <>
          <p>Type the invite code you were sent.</p>
          <label className={styles.field}>
            <span>Invite code</span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="7K3QM-9XT2B-QW4RT-ZP0HK"
              required
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        </>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy || typed.length === 0}>
        {busy ? "Checking…" : "Continue"}
      </button>
      <Link className="muted" href="/sign-in">
        Already joined on another device? Sign in
      </Link>
    </form>
  );
}
