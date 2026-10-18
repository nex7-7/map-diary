import { Hono } from "hono";
import { cors } from "hono/cors";
import { AUTH_HEADERS } from "@map-diary/crypto";
import { accounts, me } from "./accounts";
import { backupFetch, backupWrite } from "./backup";
import { envelopes } from "./envelopes";
import { resolverJobs, resolverWork } from "./resolver";
import { tiles } from "./tiles";

// Every API route lives under /api so the web app can later own the rest of
// map.snehilsinha.com on the same origin.
export const app = new Hono<{ Bindings: Env }>().basePath("/api");

// Only needed for local web development; in production the web app and the
// API share an origin.
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000"],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
    allowHeaders: ["Content-Type", "Authorization", "Range", "If-None-Match", ...Object.values(AUTH_HEADERS)],
    exposeHeaders: ["Content-Range", "Content-Length", "ETag"],
    maxAge: 86400,
  }),
);

app.get("/health", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS migrations FROM d1_migrations",
  ).first<{ migrations: number }>();
  return c.json({ ok: true, migrations: row?.migrations ?? 0 });
});

app.route("/", accounts);
app.route("/", me);
app.route("/", backupFetch);
app.route("/", backupWrite);
app.route("/", envelopes);
app.route("/", resolverWork);
app.route("/", resolverJobs);
app.route("/", tiles);

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Never echo request bodies or error details: they may carry envelope data.
app.onError((err, c) => {
  console.error("unhandled error", err.name);
  return c.json({ error: "internal" }, 500);
});
