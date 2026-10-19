import "./sodium-wasm";
import { app } from "./app";
import { expirePairings } from "./pairings";
import { expireResolverJobs } from "./scheduled";

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await expireResolverJobs(env.DB, controller.scheduledTime);
    await expirePairings(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
