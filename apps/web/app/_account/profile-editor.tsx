"use client";

import { useRef, useState } from "react";
import type { Diary } from "@/lib/device";
import { setProfile } from "@/lib/entries/actions";
import { userMessage } from "@/lib/errors";
import { oneEmoji } from "@/lib/entries/emoji";
import { photoAvatar } from "@/lib/entries/photo";
import { DISPLAY_NAME_MAX, cleanDisplayName, type AvatarPayload, type AvatarTone, type ProfilePayload } from "@/lib/places/payloads";
import { Button } from "@/lib/ui";
import { Avatar, accountStyles as s } from "./parts";

const QUICK_EMOJI = ["🍛", "☕", "🌊", "🎬", "🌶️", "🐈", "🌸", "🛺"];
const TONES: readonly AvatarTone[] = [0, 1, 2, 3];

/**
 * Your name and picture, as everyone on the app sees them: a photo shrunk on this device, an
 * emoji on a colour, or your initial. Used by onboarding and the You page.
 */
export function ProfileEditor({
  diary,
  masterId,
  current,
  takenNames,
  submitLabel = "Save",
  onSaved,
}: {
  diary: Diary;
  masterId: string;
  current: ProfilePayload | undefined;
  /** Other people's names, to warn about a clash. */
  takenNames: readonly string[];
  submitLabel?: string;
  onSaved?: (profile: ProfilePayload) => void;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [avatar, setAvatar] = useState<AvatarPayload | undefined>(current?.avatar);
  const [emojiDraft, setEmojiDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saved"; name: string } | { kind: "error"; message: string }>({ kind: "idle" });
  const file = useRef<HTMLInputElement>(null);

  const clean = cleanDisplayName(name);
  const clash = clean !== "" && takenNames.some((n) => n.toLocaleLowerCase() === clean.toLocaleLowerCase());
  const tone: AvatarTone = avatar?.kind === "emoji" ? avatar.tone : 0;
  const unchanged = clean === (current?.name ?? "") && JSON.stringify(avatar ?? null) === JSON.stringify(current?.avatar ?? null);

  const fail = (err: unknown) => setState({ kind: "error", message: userMessage(err) });

  function pickEmoji(emoji: string, t: AvatarTone = tone) {
    if (emoji) setAvatar({ kind: "emoji", emoji, tone: t });
  }

  return (
    <form
      className={s.sec}
      style={{ gap: 18 }}
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setState({ kind: "idle" });
        setProfile(diary, { name, avatar: avatar ?? null }, masterId)
          .then((saved) => {
            setState({ kind: "saved", name: saved.name });
            onSaved?.(saved);
          }, fail)
          .finally(() => setBusy(false));
      }}
    >
      <div className={s.row} style={{ gap: 14, borderBottom: 0, padding: 0 }}>
        <Avatar big id={diary.device.accountId} name={clean || "?"} avatar={avatar} />
        <div className={s.buttons}>
          <Button size="m" variant="secondary" onClick={() => file.current?.click()} disabled={busy}>
            {avatar?.kind === "photo" ? "Change photo" : "Choose a photo"}
          </Button>
          {avatar && (
            <Button size="m" variant="ghost" onClick={() => setAvatar(undefined)} disabled={busy}>
              Use my initial
            </Button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setState({ kind: "idle" });
            photoAvatar(f).then(setAvatar, fail);
          }}
        />
      </div>

      <div className={s.field}>
        <span className={s.label}>Or an emoji</span>
        <div className={s.buttons} role="group" aria-label="Emoji">
          {QUICK_EMOJI.map((em) => (
            <button
              key={em}
              type="button"
              className={s.roundButton}
              aria-pressed={avatar?.kind === "emoji" && avatar.emoji === em}
              onClick={() => pickEmoji(em)}
            >
              {em}
            </button>
          ))}
          <input
            className={`${s.input} ${s.onSurface}`}
            style={{ width: 72, padding: "8px 10px" }}
            aria-label="Any other emoji"
            placeholder="✏️"
            value={emojiDraft}
            onChange={(e) => {
              const em = oneEmoji(e.target.value);
              setEmojiDraft(em);
              pickEmoji(em);
            }}
          />
        </div>
        {avatar?.kind === "emoji" && (
          <div className={s.buttons} role="group" aria-label="Colour">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                className={`${s.avatar} ${s[`tone${t}`]}`}
                style={{ cursor: "pointer", outline: t === tone ? "2px solid var(--ink)" : undefined }}
                aria-label={`Colour ${t + 1}`}
                aria-pressed={t === tone}
                onClick={() => pickEmoji(avatar.emoji, t)}
              />
            ))}
          </div>
        )}
      </div>

      <label className={s.field}>
        <span className={s.label}>Your name</span>
        <input
          className={`${s.input} ${s.onSurface}`}
          autoComplete="nickname"
          maxLength={DISPLAY_NAME_MAX}
          placeholder="What friends call you"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className={s.hint}>
          {clash
            ? `Someone on the app is already called ${clean}. You can keep it, but a surname initial helps friends tell you apart.`
            : "Everyone on the app sees your name and picture next to your opinions. Both are encrypted on the Public board, so the server can't see them."}
        </span>
      </label>

      <div className={s.buttons}>
        <Button type="submit" disabled={busy || !clean || unchanged}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
      {state.kind === "saved" && (
        <p className={s.okText} role="status">
          Saved. Friends see you as {state.name}.
        </p>
      )}
      {state.kind === "error" && (
        <p className={s.error} role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
