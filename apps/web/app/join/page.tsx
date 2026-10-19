import type { Metadata } from "next";
import { JoinPage } from "./join-page";

export const metadata: Metadata = { title: "Join a group · Mumbai Places Diary" };

export default function Page() {
  return <JoinPage />;
}
