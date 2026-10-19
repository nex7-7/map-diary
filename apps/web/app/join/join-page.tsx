"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import entries from "@/app/_entries/entries.module.css";
import { groupErrorMessage } from "@/app/groups/messages";
import { DeviceGate, type Diary } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { inviteSecretFrom, joinGroup, previewInvite, type OpenedInvite } from "@/lib/groups";

/** `/join#<secret>`: a group invite link. The secret after the `#` never reaches the server. */
export function JoinPage() {
  return (
    <main>
      <Link href="/" className={entries.back}>
        ← Diary
      </Link>
      <h1 style={{ margin: "12px 0 16px" }}>Join a group</h1>
      <DeviceGate>{(diary) => <Join diary={diary} />}</DeviceGate>
    </main>
  );
}

function Join({ diary }: { diary: Diary }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [invite, setInvite] = useState<OpenedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    read.current ??= inviteSecretFrom(window.location.hash);
    const s = read.current;
    setSecret(s);
    // Keep the secret out of the address bar and history once read.
    if (s) window.history.replaceState(null, "", window.location.pathname);
    if (!s) return;
    previewInvite(diary, s).then(setInvite, (err: unknown) => setError(groupErrorMessage(err)));
  }, [diary]);

  async function join() {
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      await joinGroup(diary, secret);
      router.push("/groups");
    } catch (err) {
      setError(groupErrorMessage(err));
      setBusy(false);
    }
  }

  if (secret === undefined) return <p className="muted">Opening the invite…</p>;
  if (secret === null) {
    return (
      <div className={styles.card}>
        <p>This link is missing its invite. Open the whole link again, or paste it on the Groups page.</p>
        <Link className={styles.secondary} href="/groups">
          Go to Groups
        </Link>
      </div>
    );
  }
  return (
    <div className={styles.card}>
      {error ? (
        <p className={styles.error}>{error}</p>
      ) : !invite ? (
        <p className="muted">Opening the invite…</p>
      ) : invite.isMember ? (
        <p>You&apos;re already in {invite.groupName}.</p>
      ) : (
        <>
          <p>
            Join <strong>{invite.groupName}</strong>? It has {invite.members} {invite.members === 1 ? "person" : "people"}.
            They&apos;ll see what you post to this group, and you&apos;ll see theirs.
          </p>
          <button className={styles.button} type="button" disabled={busy} onClick={() => void join()}>
            {busy ? "Joining…" : "Join group"}
          </button>
        </>
      )}
      <Link className={styles.secondary} href="/groups">
        Go to Groups
      </Link>
    </div>
  );
}
