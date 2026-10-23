import type { MetadataRoute } from "next";

/**
 * Makes the diary installable: Install app on Android and desktop Chrome, Add to Home Screen on
 * iPhone. Installed on Android, it also shows in the share sheet: `/share` opens the Add sheet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mumbai Places Diary",
    short_name: "Places Diary",
    description: "A private, end-to-end encrypted map diary.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#efe8d9",
    theme_color: "#efe8d9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
