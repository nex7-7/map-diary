"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PASSPHRASE_MIN_LENGTH, PairingError, type OpenPairing, type PairingCheck } from "@map-diary/sync";
import { AccountPage, IconTile, accountStyles as s, day, seen } from "@/app/_account/parts";
import { claudeErrorMessage, errorMessage, pairingErrorMessage, revokeErrorMessage } from "@/app/(device)/messages";
import {
  addDevice,
  choosePassphrase,
  connectClaudeDevice,
  listDevices,
  removeDevice,
  renameDevice,
  type AccountOverview,
  type Diary,
  type ListedDevice,
} from "@/lib/device";
import { DEVICE_NAME_MAX } from "@/lib/places/payloads";
import { useGroups } from "@/lib/groups";
import { Badge, BoardBadge, Button, CloseButton, CopyCode, Icon, type IconName, MoreMenu, Segmented, Sheet } from "@/lib/ui";

const POLL_MS = 2000;

const KIND_LABEL: Record<string, string> = { web: "Web app", android: "Android app", claude: "Claude" };
const KIND_ICON: Record<string, IconName> = { web: "laptop", android: "phone", claude: "sparkles" };

function iconFor(d: ListedDevice): IconName {
  if (d.kind === "web" && d.name && /iPhone|Android phone/.test(d.name)) return "phone";
  return KIND_ICON[d.kind] ?? "laptop";
}

function nameOf(d: ListedDevice): string {
  return d.kind === "claude" ? "Claude" : (d.name ?? KIND_LABEL[d.kind] ?? "Device");
}

/** `/devices`: the devices signed in to this account, adding one, Claude, and the account's keys. */
export function DevicesPage() {
  return (
    <AccountPage current="devices" title="Devices" sub="Each device holds its own key. Remove one you’ve lost and your other devices move to new keys.">
      {(diary) => <Devices diary={diary} />}
    </AccountPage>
  );
}

type Open = { kind: "add" } | { kind: "claude" } | { kind: "remove"; device: ListedDevice } | { kind: "passphrase" } | null;

export function Devices({ diary }: { diary: Diary }) {
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    listDevices(diary).then(
      (o) => {
        setOverview(o);
        setLoadFailed(false);
      },
      () => {
        setOverview((o) => o ?? { devices: [], signedOut: [], isAdmin: false, hasPassphrase: true });
        setLoadFailed(true);
      },
    );
  }, [diary]);
  useEffect(load, [load]);

  const close = () => setOpen(null);
  const devices = overview?.devices ?? null;
  const self = devices?.find((d) => d.current);
  const others = devices?.filter((d) => !d.current) ?? [];
  const hasClaude = others.some((d) => d.kind === "claude");

  const row = (d: ListedDevice) => (
    <DeviceRow
      key={d.id}
      device={d}
      renaming={renaming === d.id}
      onRename={() => setRenaming(d.id)}
      onRenamed={() => {
        setRenaming(null);
        load();
      }}
      onRemove={() => setOpen({ kind: "remove", device: d })}
      diary={diary}
    />
  );

  return (
    <>
      {loadFailed && <p className={s.error}>Couldn&apos;t load your devices. Check your connection and reload.</p>}
      {notice && (
        <p className={s.okText} role="status">
          {notice}
        </p>
      )}

      <div className={hasClaude ? undefined : s.actions2}>
        <button type="button" className={s.action} onClick={() => setOpen({ kind: "add" })}>
          <IconTile name="qr" />
          <span className="heading-s">Add a device</span>
          <span className="sub">Show a code to scan on the new one</span>
        </button>
        {devices && !loadFailed && !hasClaude && (
          <button type="button" className={s.action} onClick={() => setOpen({ kind: "claude" })}>
            <IconTile name="sparkles" tone="claude" />
            <span className="heading-s">Connect Claude</span>
            <span className="sub">Let Claude read and add to Public and Personal</span>
          </button>
        )}
      </div>

      {overview && overview.signedOut.length > 0 && (
        <section className={`${s.card} ${s.sec}`}>
          <h2 className="heading-s">Signed out by the admin</h2>
          <p className="sub" style={{ margin: 0 }}>
            {overview.signedOut.length === 1 ? "This device can’t sync any more" : "These devices can’t sync any more"}. Finish removing{" "}
            {overview.signedOut.length === 1 ? "it" : "them"} with your passphrase or recovery phrase, so your boards move to new keys it can’t read.
          </p>
          <ul className={s.list}>
            {overview.signedOut.map((d) => (
              <li key={d.id} className={s.row}>
                <IconTile name={iconFor(d)} tone="danger" />
                <span className={s.rowText}>
                  <span className={s.name}>{nameOf(d)}</span>
                  <span className="sub">
                    {KIND_LABEL[d.kind] ?? d.kind} · added {day(d.createdAt)}
                  </span>
                </span>
                <Button variant="secondary" size="m" onClick={() => setOpen({ kind: "remove", device: d })}>
                  Finish
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {devices === null ? (
        <p className="sub">Loading…</p>
      ) : (
        <>
          {self && (
            <section className={s.sec}>
              <h2 className="kicker">This device</h2>
              <ul className={s.list}>{row(self)}</ul>
            </section>
          )}
          {others.length > 0 && (
            <section className={s.sec}>
              <h2 className="kicker">Other devices</h2>
              <ul className={s.list}>{others.map(row)}</ul>
            </section>
          )}
        </>
      )}

      {overview && !loadFailed && (
        <section className={s.sec}>
          <h2 className="kicker">Keys</h2>
          <ul className={s.list}>
            <li className={s.row}>
              <IconTile name="key" />
              <span className={s.rowText}>
                <span className={s.name}>Recovery phrase</span>
                <span className="sub">Shown once at setup. It restores everything.</span>
              </span>
            </li>
            <li className={s.row}>
              <IconTile name="lock" />
              <span className={s.rowText}>
                <span className={s.name}>Passphrase</span>
                <span className="sub">
                  {overview.hasPassphrase
                    ? "Set. Lets you sign in on a new device."
                    : "Not set. A new device can sign in only with this one nearby or with your recovery phrase."}
                </span>
              </span>
            </li>
          </ul>
          <div>
            <Button variant="secondary" size="m" onClick={() => setOpen({ kind: "passphrase" })}>
              {overview.hasPassphrase ? "Change passphrase" : "Set a passphrase"}
            </Button>
          </div>
        </section>
      )}

      <Sheet open={open?.kind === "add"} onClose={close} label="Add a device">
        <AddDevice
          diary={diary}
          onDone={(added) => {
            close();
            load();
            if (added) setNotice("Device added.");
          }}
        />
      </Sheet>
      <Sheet open={open?.kind === "claude"} onClose={close} label="Connect Claude">
        <ConnectClaude
          diary={diary}
          onClose={close}
          onConnected={() => {
            load();
            setNotice("Claude is connected.");
          }}
        />
      </Sheet>
      <Sheet open={open?.kind === "remove"} onClose={close} label="Remove a device">
        {open?.kind === "remove" && (
          <RemoveDevice
            diary={diary}
            device={open.device}
            onCancel={close}
            onDone={() => {
              close();
              load();
              setNotice(`${nameOf(open.device)} removed. Your other devices are on new keys.`);
            }}
          />
        )}
      </Sheet>
      <Sheet open={open?.kind === "passphrase"} onClose={close} label="Passphrase">
        {overview && (
          <Passphrase
            diary={diary}
            hasPassphrase={overview.hasPassphrase}
            onCancel={close}
            onDone={() => {
              close();
              load();
              setNotice("Passphrase saved. You can use it to sign in on a new device.");
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function DeviceRow({
  diary,
  device: d,
  renaming,
  onRename,
  onRenamed,
  onRemove,
}: {
  diary: Diary;
  device: ListedDevice;
  renaming: boolean;
  onRename: () => void;
  onRenamed: () => void;
  onRemove: () => void;
}) {
  const claude = d.kind === "claude";
  const what = claude ? "Reads Public and Personal only" : `${KIND_LABEL[d.kind] ?? d.kind} · added ${day(d.createdAt)}`;
  return (
    <li className={s.row}>
      <IconTile name={iconFor(d)} {...(claude ? { tone: "claude" as const } : {})} />
      <span className={s.rowText}>
        {renaming ? (
          <RenameForm diary={diary} device={d} onDone={onRenamed} />
        ) : (
          <span className={s.rowTitle}>
            <span className={s.name}>{nameOf(d)}</span>
            {d.current && (
              <button type="button" className={s.iconButton} onClick={onRename} aria-label={`Rename ${nameOf(d)}`}>
                <Icon name="pencil" size="s" />
              </button>
            )}
            {d.current && <Badge tone="ok">This device</Badge>}
          </span>
        )}
        <span className="sub">
          {what} · {d.current ? "active now" : seen(d.lastSeenAt)}
        </span>
      </span>
      {!d.current && !renaming && (
        <MoreMenu
          label={`More for ${nameOf(d)}`}
          items={[
            ...(claude ? [] : [{ label: "Rename", icon: "pencil" as const, onSelect: onRename }]),
            { label: "Remove…", icon: "x" as const, danger: true, onSelect: onRemove },
          ]}
        />
      )}
    </li>
  );
}

function RenameForm({ diary, device, onDone }: { diary: Diary; device: ListedDevice; onDone: () => void }) {
  const [name, setName] = useState(device.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await renameDevice(diary, device.id, name);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the name.");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className={s.field}>
      <div className={s.inline}>
        <input
          className={s.input}
          aria-label="Device name"
          value={name}
          maxLength={DEVICE_NAME_MAX}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onDone()}
        />
        <Button type="submit" size="m" disabled={busy || !name.trim()}>
          Save
        </Button>
        <Button variant="ghost" size="m" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
      <span className={s.hint}>Only you see this name. It is encrypted on your Personal board.</span>
      {error && <p className={s.error}>{error}</p>}
    </form>
  );
}

/**
 * Connects Claude as a device that can read and write only the Public and Personal boards,
 * never a group. The connector secret is shown once; this device does not keep it.
 */
function ConnectClaude({ diary, onClose, onConnected }: { diary: Diary; onClose: () => void; onConnected: () => void }) {
  const { groups } = useGroups(diary);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setSecret((await connectClaudeDevice(diary)).connectorSecret);
      onConnected();
    } catch (err) {
      setError(claudeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    setSecret(null);
    onClose();
  }

  const line = (ok: boolean, text: string, badge?: ReactNode) => (
    <div className={s.check}>
      <span style={{ color: ok ? "var(--visited)" : "var(--danger)" }}>
        <Icon name={ok ? "check" : "x"} size="m" />
      </span>
      <span style={{ flex: 1, color: ok ? undefined : "var(--ink-2)" }}>{text}</span>
      {badge}
    </div>
  );

  return (
    <>
      <div className={s.sheetTop}>
        <IconTile name="sparkles" tone="claude" large />
        <CloseButton onClick={done} />
      </div>
      <div>
        <h2 className="display">Connect Claude</h2>
        <p className="sub" style={{ margin: "4px 0 0" }}>
          Claude becomes one of your devices, with its own key. It can open only two boards.
        </p>
      </div>
      <div className={s.card} style={{ background: "var(--paper)" }}>
        <p className="kicker">Claude can read and add to</p>
        {line(true, "Public board", <BoardBadge kind="master" name="Public" />)}
        {line(true, "Your Personal board", <BoardBadge kind="personal" name="Personal" />)}
        <p className="kicker" style={{ marginTop: 4 }}>
          Claude can never see
        </p>
        {(groups ?? []).map((g) => (
          <div key={g.id}>{line(false, g.name || "Unnamed group", <BoardBadge kind="group" name={g.name || "Group"} />)}</div>
        ))}
        {line(false, groups && groups.length > 0 ? "Your account keys" : "Your groups or your account keys")}
      </div>

      {secret ? (
        <>
          <section className={s.sec}>
            <h3 className="kicker">Paste these into Claude</h3>
            <p className="sub" style={{ margin: 0 }}>
              In claude.ai, open Settings, then Connectors, and add a new custom connector. Keep the Map diary
              resolver connector as it is; this one is separate.
            </p>
            <div className={s.field}>
              <span className={s.label}>Name</span>
              <CopyCode label="name" value="Map diary" />
            </div>
            <div className={s.field}>
              <span className={s.label}>Server URL</span>
              <CopyCode label="server URL" value={`${window.location.origin}/api/claude/mcp`} />
            </div>
            <div className={s.field}>
              <span className={s.label}>Request header name</span>
              <CopyCode label="header name" value="Authorization" />
            </div>
            <div className={s.field}>
              <span className={s.label}>Request header value</span>
              <CopyCode label="header value" value={`Bearer ${secret}`} shown={`Bearer ${secret.slice(0, 8)}·······${secret.slice(-4)}`} />
            </div>
            <p className={s.note}>
              <span style={{ color: "var(--claude)" }}>
                <Icon name="alert" size="m" />
              </span>
              <span>The secret is shown only now. Paste it into Claude’s connector settings, then close this. This browser forgets it.</span>
            </p>
          </section>
          <Button block onClick={done}>
            I’ve saved it
          </Button>
        </>
      ) : (
        <>
          <p className="sub" style={{ margin: 0 }}>
            Things Claude adds show as yours via Claude. You can remove it here at any time.
          </p>
          {error && <p className={s.error}>{error}</p>}
          <Button variant="claude" block disabled={busy} onClick={() => void connect()}>
            <Icon name="sparkles" size="m" />
            {busy ? "Making Claude’s key…" : "Make Claude’s key"}
          </Button>
        </>
      )}
    </>
  );
}

/**
 * Sets or changes the passphrase used to sign in without another device. The recovery phrase
 * proves it is you, because this device does not keep the seed the backup is made from.
 */
function Passphrase({ diary, hasPassphrase, onCancel, onDone }: { diary: Diary; hasPassphrase: boolean; onCancel: () => void; onDone: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 16 }}>
      <div className={s.sheetTop}>
        <h2 className="heading-m">{hasPassphrase ? "Change passphrase" : "Set a passphrase"}</h2>
        <CloseButton onClick={onCancel} />
      </div>
      <p className="sub" style={{ margin: 0 }}>
        Your recovery phrase proves it’s you, because this device doesn’t keep it.
      </p>
      <label className={s.field}>
        <span className={s.label}>Your recovery phrase</span>
        <textarea
          className={`${s.input} ${s.phraseInput}`}
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
      <label className={s.field}>
        <span className={s.label}>New passphrase</span>
        <input
          className={s.input}
          type="password"
          autoComplete="new-password"
          minLength={PASSPHRASE_MIN_LENGTH}
          required
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
        />
        <span className={s.hint}>At least {PASSPHRASE_MIN_LENGTH} characters. A short sentence works well.</span>
      </label>
      <label className={s.field}>
        <span className={s.label}>Type it again</span>
        <input className={s.input} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className={s.error}>{error}</p>}
      <Button type="submit" block disabled={busy}>
        {busy ? "Saving…" : "Save passphrase"}
      </Button>
    </form>
  );
}

/** Shows a QR code and a typed code for the new device, then asks to confirm its code. */
function AddDevice({ diary, onDone }: { diary: Diary; onDone: (added: boolean) => void }) {
  const [pairing, setPairing] = useState<OpenPairing | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [seenState, setSeen] = useState<PairingCheck>({ state: "waiting" });
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
    if (!pairing || seenState.state !== "waiting") return;
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
  }, [pairing, seenState.state]);

  async function approve() {
    if (!pairing) return;
    setBusy(true);
    try {
      await pairing.approve();
      onDone(true);
    } catch (err) {
      setError(pairingErrorMessage(err));
      setBusy(false);
    }
  }

  async function cancel() {
    await pairing?.cancel();
    onDone(false);
  }

  const top = (
    <div className={s.sheetTop}>
      <h2 className="heading-m">Add a device</h2>
      <CloseButton onClick={() => void cancel()} />
    </div>
  );

  if (error) {
    return (
      <>
        {top}
        <p className={s.error}>{error}</p>
        <Button block onClick={() => setAttempt((n) => n + 1)}>
          Make a new code
        </Button>
      </>
    );
  }

  if (seenState.state === "joined") {
    return (
      <>
        {top}
        <p style={{ margin: 0 }}>
          A new {KIND_LABEL[seenState.kind]?.toLowerCase() ?? "device"} wants to join. Add it only if it shows this code:
        </p>
        <p className={s.bigCode} aria-label="Confirmation code">
          {seenState.code}
        </p>
        <Button block disabled={busy} onClick={() => void approve()}>
          {busy ? "Adding…" : "The codes match, add it"}
        </Button>
        <Button variant="ghost" block disabled={busy} onClick={() => void cancel()}>
          They don’t match
        </Button>
      </>
    );
  }

  return (
    <>
      {top}
      <p className="sub" style={{ margin: 0 }}>
        On the new device, scan this with the camera. Or open the diary there, tap the “Add this … from another device” button and type
        the code.
      </p>
      {qr ? <img className={s.qr} src={qr} alt="QR code to add a device" width={220} height={220} /> : <p className="sub">Making a code…</p>}
      {pairing && <p className={s.bigCode}>{pairing.secret}</p>}
      <p className={s.hint}>The code works once, for ten minutes.</p>
    </>
  );
}

/**
 * Confirms removing a device. The passphrase or recovery phrase is needed because this device
 * moves the account to new keys derived from it, which the removed device cannot follow.
 */
function RemoveDevice({ diary, device, onCancel, onDone }: { diary: Diary; device: ListedDevice; onCancel: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"passphrase" | "phrase">("passphrase");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = nameOf(device);

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
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 16 }}>
      <IconTile name={iconFor(device)} tone="danger" large />
      <h2 className="heading-m">{device.signedOutByAdmin ? `Finish removing ${name}` : `Remove ${name}?`}</h2>
      <p style={{ margin: 0, color: "var(--ink-2)" }}>
        {device.signedOutByAdmin
          ? "The admin signed it out, so it can’t sync. Your other devices now move to new keys, and every board you’re in gets a fresh key, so it can’t read anything new."
          : device.kind === "claude"
          ? "Claude stops working at once. Your Public and Personal boards then get fresh keys, so it can’t read anything new. You can connect Claude again later."
          : "It stops syncing at once. Your other devices then move to new keys, and every board you’re in gets a fresh key, so it can’t read anything new."}
      </p>
      <div className={s.field}>
        <span className={s.label}>Confirm with</span>
        <Segmented
          label="Confirm with"
          options={[
            ["passphrase", "Passphrase"],
            ["phrase", "Recovery phrase"],
          ]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setValue("");
          }}
        />
        {mode === "passphrase" ? (
          <input
            className={s.input}
            type="password"
            aria-label="Your passphrase"
            autoComplete="current-password"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <textarea
            className={`${s.input} ${s.phraseInput}`}
            aria-label="Your recovery phrase"
            placeholder="The 28-character recovery phrase"
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
      </div>
      {error && <p className={s.error}>{error}</p>}
      <Button type="submit" variant="danger" block disabled={busy || value.length === 0}>
        {busy ? "Removing…" : device.signedOutByAdmin ? "Finish" : "Remove device"}
      </Button>
      <Button variant="ghost" block disabled={busy} onClick={onCancel}>
        Keep it
      </Button>
    </form>
  );
}
