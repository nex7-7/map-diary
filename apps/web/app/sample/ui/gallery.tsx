"use client";

import { useState, type ReactNode } from "react";
import type { Status } from "@/lib/places/types";
import {
  AppShell,
  Badge,
  BoardBadge,
  Button,
  ChipRow,
  FilterChip,
  Icon,
  ICON_PATHS,
  MarkVisited,
  Pin,
  PlaceRow,
  Seal,
  StatusChips,
  type IconName,
} from "@/lib/ui";

const SWATCHES = ["paper", "page", "paper-deep", "rule-ink", "ink", "ink-2", "ink-3", "seal", "graphite", "indigo", "plum", "marker", "clay", "cover"];

export function ComponentGallery() {
  const [status, setStatus] = useState<Status | undefined>("want");
  const [chips, setChips] = useState<string[]>(["want"]);
  const toggle = (k: string) => setChips((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  return (
    <AppShell current="map" inboxCount={3} who="Sample · admin" isAdmin>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 20px 40px", display: "grid", gap: 32 }}>
        <div>
          <p className="kicker">Design system</p>
          <h1 className="display-xl">Components</h1>
          <p className="sub">Tokens, type, icons and the shared pieces every screen is built from.</p>
        </div>

        <Section title="Colour">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SWATCHES.map((n) => (
              <div key={n} style={{ display: "grid", gap: 4, justifyItems: "center" }}>
                <span style={{ width: 44, height: 44, borderRadius: 10, background: `var(--${n})`, border: "1px solid var(--line)" }} />
                <span className="sub">{n}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type">
          <p className="display-xl">Britannia &amp; Co.</p>
          <p className="display">Your places</p>
          <p className="heading-m">Berry pulav</p>
          <p className="heading-s">Kyani &amp; Co.</p>
          <p className="quote">“Closed on Sundays. Go before 1 pm or the pulav runs out.”</p>
          <p style={{ margin: 0 }}>Body text in Inter, for everything that isn&apos;t a heading or a place name.</p>
          <p className="kicker">Wallet bleeder</p>
        </Section>

        <Section title="Icons">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {(Object.keys(ICON_PATHS) as IconName[]).map((n) => (
              <span key={n} title={n}>
                <Icon name={n} />
              </span>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button>Save</Button>
            <Button variant="secondary">
              <Icon name="external" size="m" />
              Open in Google Maps
            </Button>
            <Button variant="ghost">Neither</Button>
            <Button variant="danger">Remove device</Button>
            <Button variant="claude">
              <Icon name="sparkles" size="m" />
              Make Claude&apos;s key
            </Button>
            <Button size="m">This one</Button>
            <Button size="m" variant="secondary" disabled>
              Disabled
            </Button>
          </div>
        </Section>

        <Section title="Status and filters">
          <StatusChips value={status} onChange={setStatus} />
          <ChipRow label="Filters">
            <FilterChip on={chips.includes("want")} onClick={() => toggle("want")}>
              Want to
            </FilterChip>
            <FilterChip on={chips.includes("visited")} onClick={() => toggle("visited")}>
              Visited
            </FilterChip>
            <FilterChip on={chips.includes("food")} onClick={() => toggle("food")}>
              🍛 Restaurant
            </FilterChip>
            <FilterChip on={chips.includes("cafe")} onClick={() => toggle("cafe")}>
              ☕ Café/Bar
            </FilterChip>
          </ChipRow>
        </Section>

        <Section title="Badges and pins">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <BoardBadge kind="personal" name="Personal" />
            <BoardBadge kind="master" name="Public" />
            <BoardBadge kind="group" name="College lot" />
            <Badge tone="ok">This device</Badge>
            <Badge tone="claude">
              <Icon name="sparkles" size="s" />
              via Claude
            </Badge>
            <Badge tone="warn">Pending</Badge>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Pin kind="visited" category="restaurant" />
            <Pin kind="want" category="cafe-bar" />
            <Pin kind="friend" category="movies" />
            <Pin kind="pending" category="custom:other" />
            <Pin kind="visited" category="restaurant" large />
          </div>
        </Section>

        <Section title="Place rows">
          <div className="dot-grid" style={{ border: "1px solid var(--line)", overflow: "hidden" }}>
            <PlaceRow
              category="restaurant"
              name="Britannia & Co."
              meta="Restaurant · Parsi · 1.6 km"
              dish={{ name: "Berry pulav", priceInr: 650 }}
              onOpen={() => {}}
              current
              action={<Seal date="12 OCT" />}
            />
            <PlaceRow
              category="restaurant"
              name="Bademiya"
              meta="Restaurant · Mughlai · 70 m"
              dish={{ name: "Chicken baida roti", priceInr: 220 }}
              onOpen={() => {}}
              action={<MarkVisited placeName="Bademiya" onClick={() => {}} />}
            />
            <PlaceRow category="cafe-bar" name="Kala Ghoda Café" meta="Aarav wants to go · Café/Bar" onOpen={() => {}} />
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h2 className="heading-m">{title}</h2>
      {children}
    </section>
  );
}
