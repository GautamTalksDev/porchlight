/* Porchlight city schema for Tiger Data (PostgreSQL with TimescaleDB).
   Run with: npm run db:migrate
   Each statement is applied separately; TimescaleDB features are skipped with a warning on plain PostgreSQL. */

CREATE EXTENSION IF NOT EXISTS timescaledb;

/* Every signed event the city has accepted. The body is the full signed event, so it can be re-verified at any time. */
CREATE TABLE IF NOT EXISTS events (
  id text NOT NULL,
  event_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('help', 'ok', 'ack', 'note', 'reply')),
  household text NOT NULL,
  origin text NOT NULL,
  delivered_by text,
  incident text,
  body jsonb NOT NULL,
  PRIMARY KEY (id, event_time)
);

/* Hypertable partitioned by the time the event happened (from its hybrid logical clock). */
SELECT create_hypertable('events', by_range('event_time', INTERVAL '1 day'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS events_household_time ON events (household, event_time DESC);
CREATE INDEX IF NOT EXISTS events_incident ON events (incident) WHERE incident IS NOT NULL;

/* Columnar compression for history older than a week, segmented by household for fast per-home lookups. */
ALTER TABLE events SET (timescaledb.compress, timescaledb.compress_segmentby = 'household', timescaledb.compress_orderby = 'event_time DESC');
SELECT add_compression_policy('events', INTERVAL '7 days', if_not_exists => TRUE);

/* Per-minute activity, kept up to date by TimescaleDB. materialized_only = false blends in the newest rows in real time. */
CREATE MATERIALIZED VIEW IF NOT EXISTS events_per_minute
  WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
  SELECT time_bucket(INTERVAL '1 minute', event_time) AS bucket, kind, count(*) AS n
  FROM events
  GROUP BY bucket, kind
  WITH NO DATA;

SELECT add_continuous_aggregate_policy('events_per_minute',
  start_offset => INTERVAL '1 day',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE);

/* One row per uplink delivery: which node carried how many events, and when. */
CREATE TABLE IF NOT EXISTS deliveries (
  time timestamptz NOT NULL DEFAULT now(),
  node_id text NOT NULL,
  node_name text,
  accepted integer NOT NULL,
  duplicates integer NOT NULL,
  rejected integer NOT NULL
);
SELECT create_hypertable('deliveries', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE);

/* Small key value store, for example the simulated city outage switch. */
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

/* Widen the events.kind check for existing databases created before neighbour replies.
   CREATE TABLE IF NOT EXISTS does not replace an older CHECK, so this step is separate and idempotent. */
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_kind_check;
ALTER TABLE events ADD CONSTRAINT events_kind_check CHECK (kind IN ('help', 'ok', 'ack', 'note', 'reply'));
