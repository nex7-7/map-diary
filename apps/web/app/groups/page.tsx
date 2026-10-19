import type { Metadata } from "next";
import { GroupsPage } from "./groups-page";

export const metadata: Metadata = { title: "Groups · Mumbai Places Diary" };

export default function Page() {
  return <GroupsPage />;
}
