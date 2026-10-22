import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
// Fonts ship with the app (the CSP allows fonts from our own origin only).
import "@fontsource/redaction/400.css";
import "@fontsource/redaction/400-italic.css";
import "@fontsource/redaction/700.css";
import "@fontsource/redaction-50/400.css";
import "@fontsource/redaction-35/700.css";
import "@fontsource/kalam/latin-400.css";
import "@fontsource/kalam/latin-700.css";
import "@fontsource-variable/inter/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mumbai Places Diary",
  description: "A private, end-to-end encrypted map diary.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Light only: the diary is paper.
  themeColor: "#efe8d9",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
