"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountPage, IconTile, accountStyles as s } from "@/app/_account/parts";
import { userMessage } from "@/lib/errors";
import { useSession, type Diary } from "@/lib/device";
import { joinGroup, previewInvite, readInviteSecret, type OpenedInvite } from "@/lib/groups";
import { Button, ButtonLink, CopyCode } from "@/lib/ui";

/** `/join#<secret>`: a group invite link. The secret after the `#` never reaches the server. */
export function JoinPage() {
  const session = useSession();
  // A group invite only works for someone already on the diary, so a signed-out browser (a new
  // friend, or an iPhone where the link opened in Safari rather than the installed app) is told
  // what to do instead of landing on the plain welcome screen with the link lost.
  if (session.state === "signed-out") return <SignedOut />;
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
        (err: unknown) => live && setError(userMessage(err)),
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
      setError(userMessage(err));
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

function SignedOut() {
  const [link, setLink] = useState<string | null | undefined>(undefined);
  const [iphone, setIphone] = useState(false);
  useEffect(() => {
    let live = true;
    void readInviteSecret(window.location.hash).then((secret) => {
      if (live) setLink(secret ? `${window.location.origin}/join#${secret}` : null);
    });
    setIphone(/iPhone|iPad|iPod/.test(navigator.userAgent));
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className={s.page}>
      <header className={s.head}>
        <h1 className="display">Join a group</h1>
      </header>
      <div className={s.card}>
        <IconTile name="users" large />
        <h2 className="heading-m">This is an invite to a group</h2>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          Group invites are for people already on the diary, and this {iphone ? "browser" : "device"} isn&apos;t signed in.
        </p>
        {iphone ? (
          <p style={{ margin: 0 }}>
            On iPhone, links open in Safari instead of the diary on your Home Screen. Copy the link below, open the diary
            from your Home Screen, go to <strong>Groups</strong> and paste it under <strong>Got an invite?</strong> New to
            the diary? You first need an app invite from the person who runs it.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            Already on the diary? Sign in on this device, then open the link again. New to it? You first need an app
            invite from the person who runs the diary; set up with that, then open this link again.
          </p>
        )}
        {link && <CopyCode label="group invite link" value={link} />}
        {link === null && <p className={s.error}>This link is missing its invite. Open the whole link again.</p>}
        {!iphone && (
          <>
            <ButtonLink href="/sign-in" block>
              Sign in on this device
            </ButtonLink>
            <ButtonLink href="/invite" variant="secondary" block>
              I have an app invite
            </ButtonLink>
          </>
        )}
      </div>
    </main>
  );
}
