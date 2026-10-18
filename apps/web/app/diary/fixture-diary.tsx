"use client";

import { useState } from "react";
import { createFixtureSource } from "@/lib/places/source";
import { DiaryView } from "./diary-view";

/** The diary over sample data, until keys and sync on the device are in. */
export function FixtureDiary() {
  const [source] = useState(createFixtureSource);
  return <DiaryView source={source} />;
}
