import StoryScroll from "@/components/landing/StoryScroll";
import { publicHouseholds, simReport } from "@/lib/public-data";
import { NEED_LABELS, registry } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default function Home() {
  const { households, nodeHouseIds } = publicHouseholds();
  const reg = registry();
  // Fictional demo households. The needs appear only in the example ranking, labelled as an example.
  const needs = Object.fromEntries(Object.entries(reg.households).map(([id, h]) => [id, h.needs.map((n) => NEED_LABELS[n]?.en ?? n)]));
  return <StoryScroll households={households} nodeHouseIds={nodeHouseIds} needs={needs} sim={simReport()} repo={process.env.REPO_URL || "https://github.com"} />;
}
