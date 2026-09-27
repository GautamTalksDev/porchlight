/**
 * Open311 GeoReport v2 shaped views of Porchlight calls.
 * Pure functions: safe for unit tests, no Node built-ins, no free text from the street.
 */
import { NEED_LABELS } from "./needs";
import { powerDependentNeedPhrase } from "./power";

export const OPEN311_SERVICE_CODES = ["call_for_help", "wellness_check", "power_out"] as const;
export type Open311ServiceCode = (typeof OPEN311_SERVICE_CODES)[number];

export interface Open311Service {
  service_code: Open311ServiceCode;
  service_name: string;
  description: string;
  metadata: false;
  type: "realtime";
}

export const OPEN311_SERVICES: Open311Service[] = [
  {
    service_code: "call_for_help",
    service_name: "Call for help",
    description: "A Porchlight household pressed a beacon or was escalated from a wellness check.",
    metadata: false,
    type: "realtime",
  },
  {
    service_code: "wellness_check",
    service_name: "Wellness check for a silent home",
    description: "A vulnerable home has sent no sign of life since the emergency was declared.",
    metadata: false,
    type: "realtime",
  },
  {
    service_code: "power_out",
    service_name: "Power-dependent resident without power",
    description: "A home that depends on power for medical equipment reported lights out during an emergency.",
    metadata: false,
    type: "realtime",
  },
];

export interface Open311Request {
  service_request_id: string;
  status: "open" | "closed";
  status_notes: string | null;
  service_code: Open311ServiceCode;
  service_name: string;
  description: string;
  agency_responsible: string;
  requested_datetime: string;
  updated_datetime: string;
  address: string;
  porchlight_priority_reason: string | null;
  porchlight_tier: string | null;
  porchlight_signature_verified: true;
}

export interface Open311IncidentInput {
  key: string;
  household: string;
  label: string;
  status: "open" | "acknowledged" | "resolved";
  openedAtMs: number;
  /** Wall time of acknowledgement, if any. */
  ackAtMs?: number | null;
  /** Wall time of resolution, if any. */
  resolvedAtMs?: number | null;
  needs: string[];
  tier?: string | null;
  /** Untrusted street text. Must never appear in Open311 description. */
  note?: string | null;
}

export interface Open311SilentInput {
  household: string;
  label: string;
  needs: string[];
  minutesSilent: number;
}

export interface Open311PowerOutInput {
  household: string;
  label: string;
  needs: string[];
}

export interface Open311BuildInput {
  incidents: Open311IncidentInput[];
  silent: Open311SilentInput[];
  powerOut: Open311PowerOutInput[];
  /** When null, wellness_check and power_out requests are omitted. */
  emergencySince: number | null;
  now: number;
}

const AGENCY = "City emergency operations";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Need category labels only: never street notes or person names. */
export function descriptionFromNeeds(needs: readonly string[]): string {
  const labels = needs.map((id) => NEED_LABELS[id]?.en ?? id).filter(Boolean);
  return labels.length ? labels.join("; ") : "No recorded needs";
}

function serviceName(code: Open311ServiceCode): string {
  return OPEN311_SERVICES.find((s) => s.service_code === code)!.service_name;
}

function incidentToRequest(inc: Open311IncidentInput): Open311Request {
  const status: "open" | "closed" = inc.status === "resolved" ? "closed" : "open";
  const status_notes = inc.status === "acknowledged" ? "Help on the way" : null;
  let updatedAt = inc.openedAtMs;
  if (inc.status === "acknowledged" && inc.ackAtMs != null) updatedAt = inc.ackAtMs;
  if (inc.status === "resolved" && inc.resolvedAtMs != null) updatedAt = inc.resolvedAtMs;
  const reasonParts: string[] = [];
  if (inc.tier === "city") reasonParts.push("no neighbour has answered");
  const powerPhrase = powerDependentNeedPhrase(inc.needs);
  if (powerPhrase) reasonParts.push(`depends on power for ${powerPhrase}`);
  return {
    service_request_id: inc.key,
    status,
    status_notes,
    service_code: "call_for_help",
    service_name: serviceName("call_for_help"),
    description: descriptionFromNeeds(inc.needs),
    agency_responsible: AGENCY,
    requested_datetime: iso(inc.openedAtMs),
    updated_datetime: iso(updatedAt),
    address: inc.label,
    porchlight_priority_reason: reasonParts.length ? reasonParts.join("; ") : null,
    porchlight_tier: inc.tier ?? null,
    porchlight_signature_verified: true,
  };
}

function silentToRequest(s: Open311SilentInput, emergencySince: number, now: number): Open311Request {
  return {
    service_request_id: `wellness_check:${s.household}`,
    status: "open",
    status_notes: null,
    service_code: "wellness_check",
    service_name: serviceName("wellness_check"),
    description: descriptionFromNeeds(s.needs),
    agency_responsible: AGENCY,
    requested_datetime: iso(emergencySince),
    updated_datetime: iso(now),
    address: s.label,
    porchlight_priority_reason: `not heard from for ${s.minutesSilent} minutes`,
    porchlight_tier: null,
    porchlight_signature_verified: true,
  };
}

function powerOutToRequest(h: Open311PowerOutInput, emergencySince: number, now: number): Open311Request {
  const phrase = powerDependentNeedPhrase(h.needs);
  return {
    service_request_id: `power_out:${h.household}`,
    status: "open",
    status_notes: null,
    service_code: "power_out",
    service_name: serviceName("power_out"),
    description: descriptionFromNeeds(h.needs),
    agency_responsible: AGENCY,
    requested_datetime: iso(emergencySince),
    updated_datetime: iso(now),
    address: h.label,
    porchlight_priority_reason: phrase ? `power out at a home with ${phrase}` : "power out at a power-dependent home",
    porchlight_tier: null,
    porchlight_signature_verified: true,
  };
}

/** Build the full Open311 request list from city state. Silent and power-out rows only during an emergency. */
export function buildOpen311Requests(input: Open311BuildInput): Open311Request[] {
  const out: Open311Request[] = [];
  for (const inc of input.incidents) out.push(incidentToRequest(inc));
  if (input.emergencySince != null) {
    for (const s of input.silent) out.push(silentToRequest(s, input.emergencySince, input.now));
    for (const h of input.powerOut) out.push(powerOutToRequest(h, input.emergencySince, input.now));
  }
  return out;
}

export interface Open311Query {
  status?: "open" | "closed";
  service_code?: Open311ServiceCode;
  start_date?: string;
  end_date?: string;
}

/** Apply standard GeoReport v2 list filters. */
export function filterOpen311Requests(list: Open311Request[], query: Open311Query): Open311Request[] {
  let out = list;
  if (query.status) out = out.filter((r) => r.status === query.status);
  if (query.service_code) out = out.filter((r) => r.service_code === query.service_code);
  if (query.start_date) {
    const start = Date.parse(query.start_date);
    if (!Number.isNaN(start)) out = out.filter((r) => Date.parse(r.requested_datetime) >= start);
  }
  if (query.end_date) {
    const end = Date.parse(query.end_date);
    if (!Number.isNaN(end)) out = out.filter((r) => Date.parse(r.requested_datetime) <= end);
  }
  return out;
}

/** Strip an optional trailing .json from a path segment. */
export function normalizeOpen311Id(raw: string): string {
  return raw.endsWith(".json") ? raw.slice(0, -".json".length) : raw;
}

export function findOpen311Request(list: Open311Request[], id: string): Open311Request | null {
  const key = normalizeOpen311Id(id);
  return list.find((r) => r.service_request_id === key) ?? null;
}
