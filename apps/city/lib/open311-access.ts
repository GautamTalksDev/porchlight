/**
 * Auth for the Open311 feed: coordinator session or machine key header.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { denyUnlessCoordinator } from "./auth";

function open311KeyOk(presented: string | null): boolean {
  const expected = process.env.OPEN311_KEY;
  if (!expected || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Allow a signed-in coordinator, or a machine client with X-Porchlight-Open311-Key.
 * Returns a Response to send when access is denied; null when the caller may proceed.
 */
export async function denyUnlessOpen311(req: Request): Promise<Response | null> {
  if (open311KeyOk(req.headers.get("x-porchlight-open311-key"))) return null;
  return denyUnlessCoordinator();
}
