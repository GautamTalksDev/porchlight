import "server-only";
import report from "../public/sim-report.json";
import { registry } from "./registry";

/** Only what a public page may show: fictional addresses and which demo homes host nodes. No needs. */
export function publicHouseholds() {
  const reg = registry();
  return {
    households: Object.entries(reg.households).map(([id, h]) => ({ id, label: h.label, lang: h.lang })),
    nodeHouseIds: Object.values(reg.nodes),
  };
}

export interface SimReport {
  params: { nodes: number; loss: number; cycles: number; churn: number };
  results: {
    eventsInjected: number;
    eventsAtCity: number;
    eventsLost: number;
    measuredLossRate: number;
    propagationSeconds: { p50: number; p95: number };
    recoveryAfterOutageSeconds: { p50: number; p95: number };
  };
}

/** The latest chaos run. `npm run sim:ci` refreshes public/sim-report.json; rebuild to update the site. */
export function simReport(): SimReport | null {
  const r = report as Partial<SimReport>;
  return r?.results && r.params ? (r as SimReport) : null;
}
