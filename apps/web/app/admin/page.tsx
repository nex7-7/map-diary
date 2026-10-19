import type { Metadata } from "next";
import { AdminPage } from "./admin-page";

export const metadata: Metadata = { title: "Admin · Mumbai Places Diary", robots: { index: false } };

export default function Page() {
  return <AdminPage />;
}
