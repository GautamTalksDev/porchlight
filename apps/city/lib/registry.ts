import "server-only";
import { readFileSync } from "node:fs";
import { z } from "zod";
import bundled from "../../../config/city-registry.json";
export { NEED_LABELS } from "./needs";

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
