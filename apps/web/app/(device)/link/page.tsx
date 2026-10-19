import type { Metadata } from "next";
import { LinkFlow } from "./link-flow";

export const metadata: Metadata = { title: "Add this device · Mumbai Places Diary" };

export default function LinkPage() {
  return (
    <main>
      <h1>Add this device</h1>
      <LinkFlow />
    </main>
  );
}
