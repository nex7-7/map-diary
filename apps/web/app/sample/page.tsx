import type { Metadata } from "next";
import { FixtureDiary } from "../diary/fixture-diary";

export const metadata: Metadata = { title: "Sample · Mumbai Places Diary" };

/** The map and list over sample data, for trying the views without an account. */
export default function Page() {
  return <FixtureDiary />;
}
