// Every key this device holds sits in IndexedDB, so an injected script would be total
// compromise. The policy keeps everything on our own origin: scripts, the API, the map file and
// MapLibre's worker. `connect-src` is what stops a key from being sent anywhere else.
// Next.js inlines its bootstrap scripts, hence 'unsafe-inline'; libsodium compiles WebAssembly.
// `next dev` sends these through next.config.ts; the deployed site through out/_headers.

/** @param {string} apiOrigin */
export function securityHeaders(apiOrigin) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Links out (Google Maps, Zomato) learn nothing about which page or place they came from.
    { key: "Referrer-Policy", value: "no-referrer" },
    // Location is asked for only when the person taps near-me; nothing else is needed.
    { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
  ];
}
