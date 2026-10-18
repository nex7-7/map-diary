import type { Metadata } from "next";
import { AddPage } from "./add-page";

export const metadata: Metadata = { title: "Add a place · Mumbai Places Diary" };

export default function Page() {
  return <AddPage />;
}
