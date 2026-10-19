import type { Metadata } from "next";
import { DevicesPage } from "./devices-page";

export const metadata: Metadata = { title: "Devices · Mumbai Places Diary" };

export default function Page() {
  return <DevicesPage />;
}
