import type { Metadata } from "next";
import { SetupFlow } from "./setup-flow";

export const metadata: Metadata = { title: "Set up · Mumbai Places Diary" };

export default function SetupPage() {
  return (
    <main>
      <h1>Set up your diary</h1>
      <SetupFlow />
    </main>
  );
}
