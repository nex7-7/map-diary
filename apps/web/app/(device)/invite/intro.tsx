"use client";

import { useState } from "react";
import { IconTile } from "@/app/_account/parts";
import styles from "@/lib/device/device.module.css";
import { Button, type IconName } from "@/lib/ui";

const CARDS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "map",
    title: "Your list of Mumbai places",
    text: "Save a place from a link, its name or a pin on the map, and mark it Visited or Want to. Add tags and notes whenever you like.",
  },
  {
    icon: "lock",
    title: "You choose who sees what",
    text: "Everything you add starts on your Personal board, which only you can read. Put any opinion on the Public board for everyone on the app, or on a group you're in.",
  },
  {
    icon: "users",
    title: "Groups for your friends",
    text: "A group shares its own board, readable only by its members. Nothing on it reaches anyone else, not even the server, which only stores encrypted copies.",
  },
];

/** What an invited friend reads before their keys are made: what the app is and how sharing works. */
export function InviteIntro({ onDone }: { onDone: () => void }) {
  const [at, setAt] = useState(0);
  const card = CARDS[at]!;
  const last = at === CARDS.length - 1;
  return (
    <div className={styles.card} aria-live="polite">
      <IconTile name={card.icon} large />
      <h2 className="heading-s" style={{ margin: 0 }}>
        {card.title}
      </h2>
      <p>{card.text}</p>
      <div style={{ display: "flex", gap: 6, justifyContent: "center" }} aria-label={`Step ${at + 1} of ${CARDS.length}`}>
        {CARDS.map((c, i) => (
          <span
            key={c.title}
            style={{ width: 6, height: 6, borderRadius: "50%", background: i === at ? "var(--ink)" : "var(--line)" }}
          />
        ))}
      </div>
      <Button block onClick={() => (last ? onDone() : setAt(at + 1))}>
        {last ? "Set up my diary" : "Next"}
      </Button>
      {at > 0 ? (
        <Button block variant="ghost" onClick={() => setAt(at - 1)}>
          Back
        </Button>
      ) : (
        <Button block variant="ghost" onClick={onDone}>
          Skip
        </Button>
      )}
    </div>
  );
}
