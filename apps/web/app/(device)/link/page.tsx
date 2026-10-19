import type { Metadata } from "next";
import { FlowPage } from "../flow-page";
import { LinkFlow } from "./link-flow";

export const metadata: Metadata = { title: "Add this device · Mumbai Places Diary" };

export default function LinkPage() {
  return (
    <FlowPage title="Add this device">
      <LinkFlow />
    </FlowPage>
  );
}
