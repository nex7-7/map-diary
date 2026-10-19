import type { Metadata } from "next";
import { FlowPage } from "../flow-page";
import { InviteFlow } from "./invite-flow";

export const metadata: Metadata = { title: "Join · Mumbai Places Diary" };

export default function InvitePage() {
  return (
    <FlowPage title="Join the diary" sub="Type the invite code you were sent, or open the invite link.">
      <InviteFlow />
    </FlowPage>
  );
}
