"use client";

import { useCallback, useEffect, useState } from "react";
import { accountStyles as s } from "@/app/_account/parts";
import { inviteErrorMessage } from "@/app/(device)/messages";
import { exportSql, storage, type AdminStorageView, type Diary } from "@/lib/device";
import { Button } from "@/lib/ui";

function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 ** 2) return `${(bytes / 1000).toFixed(1)} kB`;
  if (bytes < 1000 ** 3) return `${(bytes / 1000 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1000 ** 3).toFixed(2)} GB`;
}

function Meter({ label, used, limit }: { label: string; used: number | null; limit: number }) {
  const share = used === null ? 0 : Math.min(1, used / limit);
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <div className={s.meter} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used ?? 0}>
        <span style={{ width: `${Math.max(share * 100, used ? 1 : 0)}%` }} />
      </div>
      <span className="sub">
        {used === null ? "Not found" : `${size(used)} of the ${size(limit)} free tier · ${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`}
      </span>
    </div>
  );
}

/** Storage against the free tier, and a SQL backup of the database to save. */
export function AdminData({ diary }: { diary: Diary }) {
  const [usage, setUsage] = useState<AdminStorageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    storage(diary).then(
      (u) => {
        setUsage(u);
        setError(null);
      },
      (err: unknown) => setError(inviteErrorMessage(err)),
    );
  }, [diary]);
  useEffect(load, [load]);

  async function download() {
    setError(null);
    setNotice(null);
    setExporting("Starting…");
    try {
      const sql = await exportSql(diary, (table) => setExporting(`Reading ${table}…`));
      const url = URL.createObjectURL(new Blob([sql], { type: "application/sql" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `map-diary-${new Date().toISOString().slice(0, 10)}.sql`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice(`Backup saved (${size(sql.length)}).`);
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className={s.grid2}>
      <section className={s.card}>
        <h2 className="heading-s">Storage</h2>
        {error && !usage && <p className={s.error}>{error}</p>}
        {!usage && !error && <p className="sub">Loading…</p>}
        {usage && (
          <>
            <Meter label="Database (D1)" used={usage.d1.sizeBytes} limit={usage.d1.limitBytes} />
            <Meter label="Map file (R2)" used={usage.r2.mapFileBytes} limit={usage.r2.limitBytes} />
            <ul className={s.list}>
              {usage.d1.tables.map((t) => (
                <li key={t.name} className={s.row} style={{ padding: "6px 0" }}>
                  <span className={s.rowText}>
                    <span className="sub">{t.name}</span>
                  </span>
                  <span className="sub">
                    {t.rows.toLocaleString("en-IN")} {t.rows === 1 ? "row" : "rows"}
                  </span>
                </li>
              ))}
            </ul>
            <p className={s.hint}>Daily limits (5 million rows read, 100,000 written, 100,000 requests) are on the Cloudflare dashboard.</p>
          </>
        )}
      </section>
      <section className={s.card}>
        <h2 className="heading-s">Backup</h2>
        <p className="sub" style={{ margin: 0 }}>
          Saves the whole database as a SQL file. It holds what the server holds: sealed envelopes, wrapped keys and everyone&apos;s passphrase-sealed backups,
          never anything readable. Keep it private all the same.
        </p>
        <p className={s.hint}>To restore into an empty database: wrangler d1 execute map-diary --remote --file=the-file.sql</p>
        {notice && (
          <p className={s.okText} role="status">
            {notice}
          </p>
        )}
        {error && usage && <p className={s.error}>{error}</p>}
        <div>
          <Button size="m" disabled={exporting !== null} onClick={() => void download()}>
            {exporting ?? "Download backup"}
          </Button>
        </div>
      </section>
    </div>
  );
}
