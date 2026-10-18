import type { Metadata } from "next";
import { TagsPage } from "./tags-page";

export const metadata: Metadata = { title: "Tags · Mumbai Places Diary" };

export default function Page() {
  return <TagsPage />;
}
