import type { Metadata } from "next";
import { ProfilePage } from "./profile-page";

export const metadata: Metadata = { title: "Your name · Mumbai Places Diary" };

export default function Page() {
  return <ProfilePage />;
}
