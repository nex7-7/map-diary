// Starts the Worker under `wrangler dev` (real workerd rules, unlike the vitest pool) and
// checks that routes using libsodium answer. Catches code that breaks only in a deployed
// Worker, such as random values drawn in global scope.
import { spawn, execFileSync } from "node:child_process";

const port = 8799;
const base = `http://127.0.0.1:${port}`;
const persist = ".wrangler/smoke";

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "map-diary", "--local", "--persist-to", persist], {
  stdio: "ignore",
});
const dev = spawn("npx", ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", persist], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let log = "";
dev.stdout.on("data", (d) => (log += d));
dev.stderr.on("data", (d) => (log += d));

const stop = () => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
};

async function check(name, path, init, expectedStatus) {
  const res = await fetch(base + path, init);
  const ok = res.status === expectedStatus;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${res.status} (want ${expectedStatus})`);
  return ok;
}

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    up = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
  }
  if (!up) throw new Error("wrangler dev did not start");

  const results = [
    await check("health", "/api/health", {}, 200),
    // Loads libsodium (ready()) and queries D1 without any keys.
    await check("key backup fetch", "/api/key-backup/fetch", {
      method: "POST",
      body: JSON.stringify({ lookup: "A".repeat(43) }),
    }, 404),
    await check("signed route without signature", "/api/me", {}, 401),
  ];
  if (results.includes(false)) {
    console.log(log.split("\n").filter((l) => /error|disallowed/i.test(l)).slice(0, 20).join("\n"));
    process.exitCode = 1;
  }
} catch (err) {
  console.error(String(err));
  console.log(log.slice(-4000));
  process.exitCode = 1;
} finally {
  stop();
}
