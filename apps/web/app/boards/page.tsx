import type { Metadata } from "next";
import { BoardsPage } from "./boards-page";

export const metadata: Metadata = { title: "Boards · Mumbai Places Diary" };

export default function Page() {
  return <BoardsPage />;
}
