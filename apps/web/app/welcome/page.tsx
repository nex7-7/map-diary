import type { Metadata } from "next";
import { WelcomePage } from "./welcome-page";

export const metadata: Metadata = { title: "Welcome · Mumbai Places Diary" };

export default function Page() {
  return <WelcomePage />;
}
