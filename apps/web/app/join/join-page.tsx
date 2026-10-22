"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountPage, IconTile, accountStyles as s } from "@/app/_account/parts";
import { groupErrorMessage } from "@/app/groups/messages";
import type { Diary } from "@/lib/device";
import { joinGroup, previewInvite, readInviteSecret, type OpenedInvite } from "@/lib/groups";
import { Button, ButtonLink } from "@/lib/ui";

/** `/join#<secret>`: a group invite link. The secret after the `#` never reaches the server. */
export function JoinPage() {
  return (
    <AccountPage current="groups" title="Join a group" back={false}>
      {(diary) => <Join diary={diary} />}
    </AccountPage>
  );
}

function Join({ diary }: { diary: Diary }) {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null | undefined>(undefined);
  const [invite, setInvite] = useState<OpenedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRef<Promise<string | null> | undefined>(undefined);

  useEffect(() => {
    // Read the hash once, and only after libsodium has loaded: checking the secret needs it,
    // and on a freshly opened link it may not be ready yet.
    read.current ??= readInviteSecret(window.location.hash);
    let live = true;
    void read.current.then((secretRead) => {
      if (!live) return;
      setSecret(secretRead);
      // Keep the secret out of the address bar and history once read.
      if (secretRead) window.history.replaceState(null, "", window.location.pathname);
      if (!secretRead) return;
      previewInvite(diary, secretRead).then(
        (opened) => live && setInvite(opened),
        (err: unknown) => live && setError(groupErrorMessage(err)),
      );
    });
    return () => {
      live = false;
    };
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

  const toGroups = (
    <ButtonLink href="/groups" variant="ghost" block>
      Go to Groups
    </ButtonLink>
  );

  if (secret === undefined) return <p className="sub">Opening the invite…</p>;
  if (secret === null) {
    return (
      <div className={s.card}>
        <p style={{ margin: 0 }}>This link is missing its invite. Open the whole link again, or paste it on the Groups page.</p>
        {toGroups}
      </div>
    );
  }
  return (
    <div className={s.card}>
      <IconTile name="users" large />
      {error ? (
        <p className={s.error}>{error}</p>
      ) : !invite ? (
        <p className="sub">Opening the invite…</p>
      ) : invite.isMember ? (
        <p style={{ margin: 0 }}>You&apos;re already in {invite.groupName}.</p>
      ) : (
        <>
          <h2 className="heading-m">Join {invite.groupName}?</h2>
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            It has {invite.members} {invite.members === 1 ? "person" : "people"}. They&apos;ll see what you post to this group,
            and you&apos;ll see theirs. Nothing on your Personal board is shared.
          </p>
          <Button block disabled={busy} onClick={() => void join()}>
            {busy ? "Joining…" : "Join group"}
          </Button>
        </>
      )}
      {toGroups}
    </div>
  );
}
