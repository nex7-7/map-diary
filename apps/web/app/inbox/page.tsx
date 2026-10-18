import type { Metadata } from "next";
import { InboxPage } from "./inbox-page";

export const metadata: Metadata = { title: "Inbox · Mumbai Places Diary" };

export default function Page() {
  return <InboxPage />;
}
