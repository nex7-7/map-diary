"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Diary } from "@map-diary/sync";
import { Icon, buttonClass } from "@/lib/ui";
import { useSession } from "./hooks";
import { wasRemoved } from "./session";
import s from "./welcome.module.css";

/**
 * Renders `children(diary)` once this device is signed in; otherwise the welcome screen, which
 * offers joining with an invite and signing in. Nothing is decrypted or shown before then.
 */
export function DeviceGate({ children }: { children: (diary: Diary) => ReactNode }) {
  const session = useSession();
  if (session.state === "loading") return <p className="sub" style={{ padding: 20 }}>Opening your diary…</p>;
  if (session.state === "ready") return <>{children(session.diary)}</>;
  return <Welcome />;
}

/**
 * Signed out. Open signup is closed after the first account, so there is no "set up" here:
 * friends join with an invite, and people already on the app add this device or sign in.
 */
export function Welcome() {
  const [removed, setRemoved] = useState(false);
  const [phone, setPhone] = useState(true);
  const [iphone, setIphone] = useState(false);
  useEffect(() => {
    setRemoved(wasRemoved());
    setPhone(window.matchMedia("(max-width: 899px)").matches);
    setIphone(/iPhone|iPad|iPod/.test(navigator.userAgent));
  }, []);
  return (
    <main className={s.welcome} style={{ padding: 0, maxWidth: "none" }}>
      <div className={s.welcomeArt}>
        <MapArt />
      </div>
      <div className={s.welcomeBody}>
        <div style={{ display: "grid", gap: 10 }}>
          <p className="kicker">Private · end-to-end encrypted</p>
          <h1 className="display-xl">Mumbai Places Diary</h1>
          <p className={s.lede}>Where you’ve been and where you want to go, shared only with the people you choose.</p>
        </div>
        {removed && (
          <p className={s.small} role="status">
            <Icon name="alert" size="m" />
            <span>This device was removed from the diary, so its copy was cleared.</span>
          </p>
        )}
        <div className={s.welcomeButtons}>
          <Link className={buttonClass({ block: true })} href="/invite">
            I have an invite
          </Link>
          <Link className={buttonClass({ variant: "secondary", block: true })} href="/sign-in">
            <Icon name="qr" size="m" />
            Add this {phone ? "phone" : "computer"} from another device
          </Link>
          <Link className={buttonClass({ variant: "ghost", block: true })} href="/sign-in?with=passphrase">
            Sign in with passphrase or recovery phrase
          </Link>
        </div>
        {iphone && (
          <p className={s.small}>
            <Icon name="phone" size="m" />
            <span>On iPhone, add this to your Home Screen first so Safari keeps your keys.</span>
          </p>
        )}
      </div>
    </main>
  );
}

/** A sketch of South Mumbai, drawn in the map's colours. */
function MapArt() {
  return (
    <svg viewBox="600 80 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden style={{ background: "var(--sea-soft)" }}>
      <path
        fill="var(--paper)"
        d="M0 0 L1440 0 L1440 110 L1190 150 L1160 250 L1220 290 L1160 320 L1215 370 L1150 410 L1120 500 C1080 590 1000 640 960 700 L915 820 C895 900 880 950 860 1000 L720 1000 C735 920 720 850 690 790 C660 730 620 690 600 640 L560 600 C640 560 680 470 690 380 C695 300 640 220 540 190 C440 170 300 250 150 330 C110 300 80 220 0 160 Z"
      />
      <g fill="var(--visited-soft)">
        <path d="M700 330 L790 320 L800 470 L712 480 Z" />
        <path d="M850 190 L960 180 L975 290 L862 300 Z" />
      </g>
      <g stroke="var(--surface)" fill="none" strokeLinecap="round">
        <path d="M585 612 C660 565 702 470 708 380 C712 300 655 215 545 200" strokeWidth="9" />
        <path d="M820 0 C800 200 790 400 772 600 C756 750 776 880 790 1000" strokeWidth="8" />
        <path d="M960 0 C945 200 930 380 905 560 C890 660 860 720 840 800" strokeWidth="7" />
        <path d="M700 420 C850 430 1000 440 1120 465" strokeWidth="6" />
        <path d="M690 300 C850 300 1000 310 1160 330" strokeWidth="6" />
        <path d="M660 140 C800 150 1000 140 1190 150" strokeWidth="7" />
        <path d="M772 600 C840 610 900 600 960 620" strokeWidth="4" />
        <path d="M730 520 C800 520 860 510 910 530" strokeWidth="4" />
      </g>
      <g fill="var(--ink-3)" style={{ font: "600 11px var(--sans)", letterSpacing: "1.5px" }}>
        <text x="930" y="385">FORT</text>
        <text x="845" y="545">KALA GHODA</text>
        <text x="760" y="850">COLABA</text>
        <text x="640" y="265">CHURCHGATE</text>
      </g>
      <text x="610" y="560" fill="var(--sea)" opacity="0.75" style={{ font: "italic 21px var(--serif)" }}>
        Back Bay
      </text>
      {(
        [
          [1035, 255, "var(--visited)"],
          [752, 400, "var(--visited)"],
          [790, 640, "var(--want)"],
          [830, 700, "var(--want)"],
          [870, 520, "var(--group)"],
          [770, 150, "var(--visited)"],
        ] as const
      ).map(([x, y, fill]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="13" fill={fill} stroke="var(--surface)" strokeWidth="3" />
      ))}
    </svg>
  );
}
