import type { NextConfig } from "next";
import { securityHeaders } from "./security-headers.mjs";

const dev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Every page is static and the server cannot read the data, so the build is plain files
  // (out/) served as Workers static assets: no page request runs Worker code.
  output: "export",
  // /sample and /sample/ui (pages named page.dev.tsx) exist only under `next dev`.
  pageExtensions: dev ? ["dev.tsx", "tsx", "ts"] : ["tsx", "ts"],
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@map-diary/crypto", "@map-diary/sync"],
  poweredByHeader: false,
  // The deployed site gets the same headers from out/_headers (scripts/finish-export.mjs).
  ...(dev && {
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders(process.env.NEXT_PUBLIC_API_ORIGIN ?? "") }];
    },
  }),
};

export default nextConfig;
