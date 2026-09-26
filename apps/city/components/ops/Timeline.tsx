"use client";

import type { TimelineBucket } from "@/lib/db";

/** Last hour of activity as stacked bars: calls for help, check-ins, responses. */
export function Timeline({ buckets, source }: { buckets: TimelineBucket[]; source: string }) {
  const now = Date.now();
  const slots = Array.from({ length: 60 }, (_, i) => {
    const t = new Date(now - (59 - i) * 60_000);
    t.setSeconds(0, 0);
    const b = buckets.find((x) => new Date(x.bucket).getTime() === t.getTime());
    return { help: b?.help ?? 0, ok: b?.ok ?? 0, ack: b?.ack ?? 0 };
  });
  const max = Math.max(1, ...slots.map((s) => s.help + s.ok + s.ack));
  const w = 600;
  const h = 64;
  const bw = w / 60;
  const total = slots.reduce((s, x) => s + x.help + x.ok + x.ack, 0);
  const sourceText: Record<string, string> = {
    "continuous-aggregate": "From a Tiger Data continuous aggregate",
    postgres: "From PostgreSQL",
    memory: "Computed in memory (no database connected)",
    unavailable: "Database unavailable",
    paused: "Timeline paused: the database is not reachable",
  };
  if (source === "paused") {
    return (
      <div className="chart">
        <p className="section-title">Last hour</p>
        <p className="section-sub">Timeline paused: the database is not reachable</p>
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="chart">
        <p className="section-title">Last hour</p>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke="rgba(236, 230, 217, 0.25)" strokeWidth="2" strokeDasharray="4 6" />
        </svg>
        <p className="chart-legend">
          <span>No activity in the last hour. The line rises the moment someone presses a beacon.</span>
          <span>{sourceText[source] ?? source}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="chart">
      <p className="section-title">Last hour</p>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${total} events in the last hour`}>
        {slots.map((s, i) => {
          const scale = (h - 4) / max;
          let y = h;
          return (
            <g key={i}>
              {(["help", "ack", "ok"] as const).map((k) => {
                const v = s[k] * scale;
                y -= v;
                return v > 0 ? <rect key={k} x={i * bw + 1} y={y} width={bw - 2} height={v} fill={k === "help" ? "#ff6a55" : k === "ack" ? "#9ec5ff" : "#f2b35e"} /> : null;
              })}
            </g>
          );
        })}
      </svg>
      <p className="chart-legend">
        <span><span className="swatch" style={{ background: "#ff6a55" }} />Calls for help</span>
        <span><span className="swatch" style={{ background: "#9ec5ff" }} />Responses</span>
        <span><span className="swatch" style={{ background: "#f2b35e" }} />Safe check-ins</span>
        <span>{sourceText[source] ?? source}</span>
      </p>
    </div>
  );
}
