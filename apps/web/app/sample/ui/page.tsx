import type { Metadata } from "next";
import { ComponentGallery } from "./gallery";

export const metadata: Metadata = { title: "Components · Mumbai Places Diary" };

/** Every shared component in its states, for checking the design system in both themes. */
export default function Page() {
  return <ComponentGallery />;
}
