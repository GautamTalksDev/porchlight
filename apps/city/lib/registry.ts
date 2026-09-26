import "server-only";
import { readFileSync } from "node:fs";
import { z } from "zod";
import bundled from "../../../config/city-registry.json";

export const NEED_LABELS: Record<string, { en: string; weight: number }> = {
  "oxygen-concentrator": { en: "Oxygen concentrator (needs power)", weight: 40 },
  "dialysis-at-home": { en: "Home dialysis (needs power)", weight: 40 },
  "insulin-refrigeration": { en: "Insulin needs refrigeration", weight: 25 },
  "age-90-plus": { en: "Over 90", weight: 20 },
  "lives-alone": { en: "Lives alone", weight: 15 },
  "mobility-aid": { en: "Uses a mobility aid", weight: 15 },
  infant: { en: "Infant at home", weight: 15 },
  "hearing-impaired": { en: "Hard of hearing", weight: 10 },
};

const Registry = z.object({
  households: z.record(
    z.string(),
    z.object({ label: z.string(), lang: z.enum(["en", "fr"]), needs: z.array(z.string()).default([]) }),
  ),
  nodes: z.record(z.string(), z.string()).default({}),
});
export type Registry = z.infer<typeof Registry>;

let cached: Registry | undefined;

/**
 * The city's household registry. Sensitive (health needs), so it lives only on the city server.
 * The fictional demo registry is bundled at build time; set CITY_REGISTRY_FILE to load a real one.
 */
export function registry(): Registry {
  if (cached) return cached;
  const override = process.env.CITY_REGISTRY_FILE;
  const raw = override ? JSON.parse(readFileSync(/* turbopackIgnore: true */ override, "utf8")) : bundled;
  cached = Registry.parse(raw);
  return cached;
}

export function householdOrder(): string[] {
  return Object.keys(registry().households);
}
