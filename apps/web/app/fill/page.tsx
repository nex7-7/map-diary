import type { Metadata } from "next";
import { FillPage } from "./fill-page";

export const metadata: Metadata = { title: "Fill in a place · Mumbai Places Diary" };

export default function Page() {
  return <FillPage />;
}
