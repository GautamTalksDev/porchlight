import { denyUnlessCoordinator } from "@/lib/auth";
import { snapshot } from "@/lib/city";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await denyUnlessCoordinator();
  if (denied) return denied;
  return Response.json(await snapshot(), { headers: { "cache-control": "no-store" } });
}
