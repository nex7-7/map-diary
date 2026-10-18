/** Deletes resolver jobs past their expiry. Returns how many were removed. */
export async function expireResolverJobs(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM resolver_jobs WHERE expires_at <= ?")
    .bind(now)
    .run();
  return result.meta.changes;
}
