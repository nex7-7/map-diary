"use client";

import { useMemo, useState } from "react";
import { useItems } from "@/app/_entries/use-items";
import { IconTile } from "@/app/_account/parts";
import { ProfileEditor } from "@/app/_account/profile-editor";
import { DeviceGate, type Diary } from "@/lib/device";
import styles from "@/lib/device/device.module.css";
import { profilesOf } from "@/lib/places/items-source";
import { Button, ButtonLink, type IconName } from "@/lib/ui";

const TIPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "plus", title: "Add a place", text: "Tap Add and paste a Google Maps, Zomato or District link, or just type the name. One tap saves it." },
  { icon: "pin", title: "Drop a pin", text: "Long-press the map to save a spot that has no link. Pins stay private to the boards you pick." },
  { icon: "lock", title: "Personal first", text: "New opinions go to your Personal board. Pick Public or a group in the Add sheet when you want to share." },
];

/**
 * `/welcome`: where a new account lands right after setup (the admin's first run, or a friend
 * joining with an invite). They pick the name and picture everyone sees, then get three tips on
 * adding places.
 */
export function WelcomePage() {
  return <DeviceGate>{(diary) => <Onboarding diary={diary} />}</DeviceGate>;
}

function Onboarding({ diary }: { diary: Diary }) {
  const [step, setStep] = useState<"profile" | "tips">("profile");
  const { loaded, items, snapshot, canChooseBoards } = useItems(diary);
  const profiles = useMemo(() => profilesOf(items), [items]);
  const me = diary.device.accountId;
  const master = canChooseBoards ? snapshot.boards.find((b) => b.kind === "master") : undefined;
  const taken = [...profiles].filter(([id]) => id !== me).map(([, p]) => p.name);

  return (
    <main className={styles.page}>
      <header style={{ display: "grid", gap: 4 }}>
        <p className="kicker">{step === "profile" ? "Step 1 of 2" : "Step 2 of 2"}</p>
        <h1 className="display">{step === "profile" ? "How friends see you" : "You're in"}</h1>
        <p className="sub" style={{ margin: 0 }}>
          {step === "profile"
            ? "Pick a name and a picture. You can change both later on the You page."
            : "Three things worth knowing before you start."}
        </p>
      </header>

      {step === "profile" && (
        <div className={styles.card}>
          {!loaded || !master ? (
            <p className="muted">Getting your diary ready…</p>
          ) : (
            <ProfileEditor diary={diary} masterId={master.id} current={profiles.get(me)} takenNames={taken} submitLabel="Continue" onSaved={() => setStep("tips")} />
          )}
          <Button variant="ghost" block onClick={() => setStep("tips")}>
            Skip for now
          </Button>
        </div>
      )}

      {step === "tips" && (
        <>
          <ul className={styles.card} style={{ listStyle: "none", margin: 0 }}>
            {TIPS.map((t) => (
              <li key={t.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <IconTile name={t.icon} />
                <span style={{ display: "grid", gap: 2 }}>
                  <strong>{t.title}</strong>
                  <span className="sub">{t.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <ButtonLink href="/" block>
            Open the diary
          </ButtonLink>
        </>
      )}
    </main>
  );
}
