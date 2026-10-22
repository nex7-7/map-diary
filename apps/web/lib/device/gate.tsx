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

/** A sketch of South Mumbai in pen and ink: a hatched sea, inked roads and pressed seals. */
function MapArt() {
  const coast =
    "M0 0 L1440 0 L1440 110 L1190 150 L1160 250 L1220 290 L1160 320 L1215 370 L1150 410 L1120 500 C1080 590 1000 640 960 700 L915 820 C895 900 880 950 860 1000 L720 1000 C735 920 720 850 690 790 C660 730 620 690 600 640 L560 600 C640 560 680 470 690 380 C695 300 640 220 540 190 C440 170 300 250 150 330 C110 300 80 220 0 160 Z";
  const roads = [
    ["M585 612 C660 565 702 470 708 380 C712 300 655 215 545 200", 11],
    ["M820 0 C800 200 790 400 772 600 C756 750 776 880 790 1000", 10],
    ["M960 0 C945 200 930 380 905 560 C890 660 860 720 840 800", 9],
    ["M700 420 C850 430 1000 440 1120 465", 7],
    ["M690 300 C850 300 1000 310 1160 330", 7],
    ["M660 140 C800 150 1000 140 1190 150", 8],
    ["M772 600 C840 610 900 600 960 620", 5],
    ["M730 520 C800 520 860 510 910 530", 5],
  ] as const;
  return (
    <svg viewBox="600 80 600 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="welcome-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="9" stroke="#2e4b5a" strokeOpacity="0.35" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="1440" height="1000" fill="#d6e0df" />
      <rect x="0" y="0" width="1440" height="1000" fill="url(#welcome-hatch)" />
      <path fill="#f1ead9" stroke="var(--indigo)" strokeWidth="2" d={coast} />
      <g fill="#dfe3c8" stroke="#3d3934" strokeOpacity="0.4" strokeWidth="1.2">
        <path d="M700 330 L790 320 L800 470 L712 480 Z" />
        <path d="M850 190 L960 180 L975 290 L862 300 Z" />
      </g>
      <g fill="none" strokeLinecap="round">
        {roads.map(([d, w]) => (
          <path key={d} d={d} stroke="#3d3934" strokeWidth={w + 3} />
        ))}
        {roads.map(([d, w]) => (
          <path key={`${d}-fill`} d={d} stroke="#fbf6ea" strokeWidth={w} />
        ))}
      </g>
      <g fill="var(--ink-2)" style={{ font: "600 11px var(--sans)", letterSpacing: "1.5px" }}>
        <text x="930" y="385">FORT</text>
        <text x="845" y="545">KALA GHODA</text>
        <text x="760" y="850">COLABA</text>
        <text x="640" y="265">CHURCHGATE</text>
      </g>
      <text x="610" y="560" fill="var(--indigo)" style={{ font: "italic 22px var(--serif)" }}>
        Back Bay
      </text>
      {(
        [
          [1035, 255, "seal"],
          [752, 400, "seal"],
          [790, 640, "want"],
          [830, 700, "want"],
          [870, 520, "plum"],
          [770, 150, "seal"],
        ] as const
      ).map(([x, y, kind]) =>
        kind === "want" ? (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="12" fill="var(--page)" stroke="var(--graphite)" strokeWidth="2.4" strokeDasharray="4 3" />
        ) : (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y + 2.5} r="14" fill="var(--ink)" />
            <circle cx={x} cy={y} r="14" fill={kind === "seal" ? "var(--seal)" : "var(--plum)"} stroke="var(--ink)" strokeWidth="2" />
            <circle cx={x} cy={y} r="8.5" fill="none" stroke="var(--cream)" strokeWidth="1.4" />
          </g>
        ),
      )}
    </svg>
  );
}
