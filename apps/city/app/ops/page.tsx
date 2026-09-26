import OpsRoom from "@/components/ops/OpsRoom";
import { SignInGate } from "@/components/ui/Gate";
import { authMode, currentCoordinator } from "@/lib/auth";
import { publicHouseholds } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const mode = authMode();
  if (mode === "not-configured") return <SignInGate reason="not-configured" />;
  const coordinator = await currentCoordinator();
  if (!coordinator) return <SignInGate reason="signed-out" />;
  const { nodeHouseIds } = publicHouseholds();
  const demoResetEnabled = process.env.DEMO_RESET_ENABLED === "true";
  return (
    <OpsRoom
      coordinator={coordinator.name}
      authMode={mode}
      nodeHouseIds={nodeHouseIds}
      demoResetEnabled={demoResetEnabled}
    />
  );
}
