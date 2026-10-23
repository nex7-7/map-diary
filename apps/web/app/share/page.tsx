import type { Metadata } from "next";
import { SharePage } from "./share-page";

export const metadata: Metadata = { title: "Add a place · Mumbai Places Diary" };

export default function Page() {
  return <SharePage />;
}
