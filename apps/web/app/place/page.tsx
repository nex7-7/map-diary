import type { Metadata } from "next";
import { PlacePage } from "./place-page";

export const metadata: Metadata = { title: "Place · Mumbai Places Diary" };

export default function Page() {
  return <PlacePage />;
}
