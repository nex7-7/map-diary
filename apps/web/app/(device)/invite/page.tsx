import type { Metadata } from "next";
import { InviteFlow } from "./invite-flow";

export const metadata: Metadata = { title: "Join · Mumbai Places Diary" };

export default function InvitePage() {
  return (
    <main>
      <h1>Join the diary</h1>
      <InviteFlow />
    </main>
  );
}
