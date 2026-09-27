"use client";

import type { TimelineBucket } from "@/lib/db";

const SOURCE_TEXT: Record<string, string> = {
  "continuous-aggregate": "Tiger Data continuous aggregate",
  postgres: "PostgreSQL",
  memory: "Computed in memory",
  unavailable: "Database unavailable",
  paused: "Paused: the database is not reachable",
};

/**
 * The last hour of the street as one line of light: a thin bar per minute, coloured by what happened.
 * Calls for help burn red, responses glow moonlight, safe check-ins glow like porch lights.
 */
export function Timeline({ buckets, source }: { buckets: TimelineBucket[]; source: string }) {
  const now = Date.now();
  const slots = Array.from({ length: 60 }, (_, i) => {
    const t = new Date(now - (59 - i) * 60_000);
    t.setSeconds(0, 0);
    const b = buckets.find((x) => new Date(x.bucket).getTime() === t.getTime());
    return { help: b?.help ?? 0, ok: b?.ok ?? 0, ack: b?.ack ?? 0 };
  });
  const total = slots.reduce((s, x) => s + x.help + x.ok + x.ack, 0);
  const helpTotal = slots.reduce((s, x) => s + x.help, 0);
  const max = Math.max(1, ...slots.map((s) => s.help + s.ok + s.ack));
  const w = 600;
  const h = 36;
  const step = w / 60;
  const paused = source === "paused";

  return (
    <div className="pulse-chart">
      <p className="pulse-label">
        <strong>Last hour</strong>
        <span>{paused ? SOURCE_TEXT.paused : total === 0 ? "No activity yet" : `${total} events, ${helpTotal} ${helpTotal === 1 ? "call" : "calls"}`}</span>
      </p>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          paused
            ? "Timeline paused"
            : `${total} events in the last hour, ${helpTotal} of them calls for help. Source: ${SOURCE_TEXT[source] ?? source}.`
        }
      >
        <defs>
          <linearGradient id="pl-baseline" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgba(241,235,223,0)" />
            <stop offset="0.25" stopColor="rgba(241,235,223,0.16)" />
            <stop offset="1" stopColor="rgba(241,235,223,0.3)" />
          </linearGradient>
        </defs>
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="url(#pl-baseline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {slots.map((s, i) => {
          const sum = s.help + s.ok + s.ack;
          if (!sum) return null;
          const scale = (h - 6) / max;
          let y = h - 1;
          const x = i * step + step / 2;
          return (
            <g key={i}>
              {(["ok", "ack", "help"] as const).map((k) => {
                const v = s[k] * scale;
                if (v <= 0) return null;
                const y2 = y - v;
                const line = (
                  <line
                    key={k}
                    x1={x}
                    x2={x}
                    y1={y}
                    y2={y2}
                    stroke={k === "help" ? "#ff6a55" : k === "ack" ? "#9ec5ff" : "#f4b560"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
                y = y2;
                return line;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
