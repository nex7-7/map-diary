import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@map-diary/crypto"],
  poweredByHeader: false,
};

export default nextConfig;

// Gives `next dev` access to Cloudflare bindings declared in wrangler.jsonc.
initOpenNextCloudflareForDev();
