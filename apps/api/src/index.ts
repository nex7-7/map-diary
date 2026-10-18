import { app } from "./app";
import { expireResolverJobs } from "./scheduled";

export default {
  fetch: app.fetch,
  async scheduled(controller, env) {
    await expireResolverJobs(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
