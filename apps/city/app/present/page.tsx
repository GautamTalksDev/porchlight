import Presenter from "@/components/present/Presenter";
import { publicHouseholds, simReport } from "@/lib/public-data";
import { NEED_LABELS, registry } from "@/lib/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Porchlight, the story" };

export default function PresentPage() {
  const { households, nodeHouseIds } = publicHouseholds();
  const reg = registry();
  // Fictional demo households only. The example ranking below is labelled as an example on screen.
  const needs = Object.fromEntries(Object.entries(reg.households).map(([id, h]) => [id, h.needs.map((n) => NEED_LABELS[n]?.en ?? n)]));
  return <Presenter households={households} nodeHouseIds={nodeHouseIds} needs={needs} sim={simReport()} />;
}
