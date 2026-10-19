"use client";

import { useState } from "react";
import { createFixtureSource } from "@/lib/places/source";
import { AppShell } from "@/lib/ui";
import { useViewMode } from "./device-diary";
import { DiaryView } from "./diary-view";

/** The diary over sample data, for trying the views without an account. */
export function FixtureDiary() {
  const [source] = useState(createFixtureSource);
  const view = useViewMode();
  return (
    <AppShell current={view} who="Sample data">
      <DiaryView source={source} view={view} />
    </AppShell>
  );
}
