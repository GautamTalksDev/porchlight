import "server-only";
import pg from "pg";
import type { SignedEvent } from "@porchlight/protocol";

const g = globalThis as unknown as { __plPool?: pg.Pool };

export function dbEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function pool(): pg.Pool {
  if (!g.__plPool) {
    g.__plPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
    g.__plPool.on("error", (err) => console.error("[db] idle client error", err.message));
  }
  return g.__plPool;
}

/** Inserts events idempotently. Returns the ids that were new to the database. */
export async function insertEvents(events: SignedEvent[], deliveredBy: string): Promise<Set<string>> {
  if (!events.length) return new Set();
  const values: unknown[] = [];
  const rows = events.map((e, i) => {
    const wall = Number(e.hlc.split(".")[0]);
    values.push(e.id, new Date(wall), e.kind, e.household, e.origin, deliveredBy, e.incident ?? null, JSON.stringify(e));
    const b = i * 8;
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::jsonb)`;
  });
  const res = await pool().query<{ id: string }>(
    `INSERT INTO events (id, event_time, kind, household, origin, delivered_by, incident, body)
     VALUES ${rows.join(", ")}
     ON CONFLICT (id, event_time) DO NOTHING
     RETURNING id`,
    values,
  );
  return new Set(res.rows.map((r) => r.id));
}

export async function loadAllEvents(): Promise<unknown[]> {
  const res = await pool().query<{ body: unknown }>("SELECT body FROM events ORDER BY event_time ASC LIMIT 100000");
  return res.rows.map((r) => r.body);
}

export async function recordDelivery(nodeId: string, nodeName: string, accepted: number, duplicates: number, rejected: number) {
  await pool().query(
    "INSERT INTO deliveries (node_id, node_name, accepted, duplicates, rejected) VALUES ($1, $2, $3, $4, $5)",
    [nodeId, nodeName, accepted, duplicates, rejected],
  );
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const res = await pool().query<{ value: T }>("SELECT value FROM settings WHERE key = $1", [key]);
  return res.rows[0]?.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await pool().query(
    "INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, JSON.stringify(value)],
  );
}

export interface TimelineBucket {
  bucket: string;
  help: number;
  ok: number;
  ack: number;
}

/** Last hour of activity per minute, served from the Tiger Data continuous aggregate. */
export async function timeline(): Promise<{ source: "continuous-aggregate" | "postgres"; buckets: TimelineBucket[] }> {
  type Row = { bucket: Date; kind: string; n: string };
  const fold = (rows: Row[]) => foldTimeline(rows.map((r) => ({ bucket: r.bucket.toISOString(), kind: r.kind, n: Number(r.n) })));
  try {
    const res = await pool().query<Row>(
      `SELECT bucket, kind, n FROM events_per_minute WHERE bucket > now() - INTERVAL '60 minutes' ORDER BY bucket`,
    );
    return { source: "continuous-aggregate", buckets: fold(res.rows) };
  } catch {
    // Plain PostgreSQL without TimescaleDB: same answer, computed on the fly.
    const res = await pool().query<Row>(
      `SELECT date_trunc('minute', event_time) AS bucket, kind, count(*) AS n FROM events
        WHERE event_time > now() - INTERVAL '60 minutes' GROUP BY 1, 2 ORDER BY 1`,
    );
    return { source: "postgres", buckets: fold(res.rows) };
  }
}

/** How long alerts were held offline before reaching the city: the resilience metric. */
export async function holdStats(): Promise<{ p50: number; p95: number; max: number; n: number }> {
  const res = await pool().query<{ p50: number | null; p95: number | null; max: number | null; n: string }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY hold) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY hold) AS p95,
            max(hold) AS max, count(*) AS n
       FROM (SELECT EXTRACT(EPOCH FROM (received_at - event_time)) AS hold FROM events
              WHERE event_time > now() - INTERVAL '24 hours') t`,
  );
  const r = res.rows[0];
  return { p50: Math.round(r?.p50 ?? 0), p95: Math.round(r?.p95 ?? 0), max: Math.round(r?.max ?? 0), n: Number(r?.n ?? 0) };
}

export function foldTimeline(rows: { bucket: string; kind: string; n: number }[]): TimelineBucket[] {
  const map = new Map<string, TimelineBucket>();
  for (const r of rows) {
    const b = map.get(r.bucket) ?? { bucket: r.bucket, help: 0, ok: 0, ack: 0 };
    if (r.kind === "help" || r.kind === "ok" || r.kind === "ack") b[r.kind] += r.n;
    map.set(r.bucket, b);
  }
  return [...map.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Empty demo event history. Does not touch settings or the city signing identity. */
export async function clearDemoTables(): Promise<void> {
  await pool().query("TRUNCATE events, deliveries");
  try {
    await pool().query("CALL refresh_continuous_aggregate('events_per_minute', NULL, NULL)");
  } catch {
    /* plain PostgreSQL or Timescale without the continuous aggregate */
  }
  try {
    await pool().query(`
      DO $body$
      DECLARE
        mat text;
      BEGIN
        SELECT format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name)
          INTO mat
          FROM timescaledb_information.continuous_aggregates
         WHERE view_name = 'events_per_minute';
        IF mat IS NOT NULL THEN
          EXECUTE format('TRUNCATE %s', mat);
        END IF;
      END
      $body$`);
  } catch {
    /* materialization table not present */
  }
}
