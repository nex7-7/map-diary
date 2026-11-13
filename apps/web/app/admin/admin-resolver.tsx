"use client";

import { useCallback, useEffect, useState } from "react";
import { accountStyles as s, day } from "@/app/_account/parts";
import { userMessage } from "@/lib/errors";
import { refreshWallets, resolver, retryAllFailed, retryJob, walletsToRefresh, type AdminResolverView, type Diary } from "@/lib/device";
import { Button, Icon } from "@/lib/ui";

/**
 * The resolver queue: what is waiting, what failed, and putting failed jobs back. Jobs are
 * anonymous, so this shows only the link or name the resolver sees, never who asked.
 */
export function AdminResolver({ diary }: { diary: Diary }) {
  const [view, setView] = useState<AdminResolverView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallets, setWallets] = useState<number | null>(null);

  const load = useCallback(() => {
    resolver(diary).then(
      (v) => {
        setView(v);
        setError(null);
      },
      (err: unknown) => setError(userMessage(err)),
    );
  }, [diary]);
  useEffect(load, [load]);
  useEffect(() => {
    walletsToRefresh(diary).then(setWallets, () => setWallets(null));
  }, [diary, notice]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      load();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (error && !view) return <p className={s.error}>{error}</p>;
  if (!view) return <p className="sub">Loading…</p>;
  const failed = view.jobs.filter((j) => j.status === "failed");
  const pending = view.jobs.filter((j) => j.status === "pending");

  return (
    <div className={s.stackCol}>
      {error && <p className={s.error}>{error}</p>}
      {notice && (
        <p className={s.okText} role="status">
          {notice}
        </p>
      )}
      <section className={s.card}>
        <h2 className="heading-s">Queue</h2>
        <div className={s.stats}>
          <div className={s.stat}>
            <strong>{view.counts.pending}</strong>
            <span>Waiting</span>
          </div>
          <div className={view.counts.failed > 0 ? `${s.stat} ${s.statAlert}` : s.stat}>
            <strong>{view.counts.failed}</strong>
            <span>Failed</span>
          </div>
          <div className={s.stat}>
            <strong>{view.counts.resolved}</strong>
            <span>Uncollected</span>
          </div>
        </div>
        <p className={s.hint}>Oldest jobs first. A job fails after 5 tries and leaves once the device that asked collects it.</p>
        <div className={s.buttons}>
          <Button
            variant="secondary"
            size="m"
            disabled={busy || failed.length === 0}
            onClick={() => void run(async () => `${await retryAllFailed(diary)} back in the queue.`)}
          >
            Retry failed jobs
          </Button>
          <Button variant="secondary" size="m" disabled={busy} onClick={load}>
            <Icon name="refresh" size="s" />
            Refresh
          </Button>
        </div>
      </section>

      <section className={s.card}>
        <h2 className="heading-s">Wallet bleeders</h2>
        <p className="sub" style={{ margin: 0 }}>
          {wallets === null ? "Counting…" : wallets === 0 ? "Every food place has a wallet bleeder from the current rules." : `${wallets} food ${wallets === 1 ? "place needs" : "places need"} one (a chain counts once).`}
        </p>
        <p className={s.hint}>
          Looks each one up again with the current rules, and adds any missing outlets of its chain. Clear matches fill in by themselves; the rest wait in your
          Inbox. Nothing else about a place changes.
        </p>
        <div className={s.buttons}>
          <Button
            variant="secondary"
            size="m"
            disabled={busy || !wallets}
            onClick={() => void run(async () => `${await refreshWallets(diary)} sent to the resolver. They fill in after its next runs.`)}
          >
            Find wallet bleeders
          </Button>
        </div>
      </section>

      <JobList title="Failed" jobs={failed} busy={busy} onRetry={(id) => void run(async () => (await retryJob(diary, id), "Back in the queue."))} />
      <JobList title="Waiting" jobs={pending} busy={busy} onRetry={(id) => void run(async () => (await retryJob(diary, id), "Its tries start again."))} />
      {view.jobs.length === 0 && <p className="sub">Nothing waiting and nothing failed.</p>}
    </div>
  );
}

type Job = AdminResolverView["jobs"][number];

function JobList({ title, jobs, busy, onRetry }: { title: string; jobs: Job[]; busy: boolean; onRetry: (id: string) => void }) {
  if (jobs.length === 0) return null;
  return (
    <section className={s.card}>
      <h2 className="heading-s">
        {title} · {jobs.length}
      </h2>
      <ul className={s.list}>
        {jobs.map((j) => (
          <li key={j.id} className={s.row} style={{ padding: "10px 0" }}>
            <span className={s.rowText}>
              <span className={s.plainName} style={{ overflowWrap: "anywhere" }}>
                {j.query ?? "(query cleared)"}
              </span>
              <span className="sub">
                Asked {day(j.createdAt)} · tried {j.attempts} {j.attempts === 1 ? "time" : "times"} · expires {day(j.expiresAt)}
              </span>
            </span>
            {j.query !== null && (j.status === "failed" || j.attempts > 0) && (
              <Button variant="secondary" size="m" disabled={busy} onClick={() => onRetry(j.id)} aria-label={`Retry ${j.query}`}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
