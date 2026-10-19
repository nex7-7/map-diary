import type { Metadata } from "next";
import { FlowPage } from "../flow-page";
import { SetupFlow } from "./setup-flow";

export const metadata: Metadata = { title: "Set up · Mumbai Places Diary" };

export default function SetupPage() {
  return (
    <FlowPage title="Set up the diary">
      <SetupFlow />
    </FlowPage>
  );
}
