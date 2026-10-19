import { Suspense } from "react";
import { DeviceDiary } from "./diary/device-diary";

export default function Home() {
  // The view comes from the URL, which a static page reads only in the browser.
  return (
    <Suspense>
      <DeviceDiary />
    </Suspense>
  );
}
