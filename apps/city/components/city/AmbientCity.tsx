"use client";

import { useEffect, useRef } from "react";
import CityCanvas from "./CityCanvas";
import type { PorchlightCity } from "@/lib/city/scene";

interface Props {
  households: { id: string; label: string }[];
  nodeHouseIds: string[];
}

/**
 * The landing page hero: the city on a loop. The storm crosses, one home calls for help, neighbours
 * relay it, the link returns, and the lights come back. Static when reduced motion is requested.
 */
export default function AmbientCity({ households, nodeHouseIds }: Props) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const onReady = (city: PorchlightCity) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const caller = households[0]?.id;
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const cycle = () => {
      households.forEach((h) => city.setHouseholdStatus(h.id, "unknown"));
      at(2500, () => {
        city.setStorm(true);
        city.setBlackout(1, 0.2);
        city.setCityLink(false);
      });
      at(8000, () => caller && city.setHouseholdStatus(caller, "help"));
      at(9000, () => {
        if (!caller) return;
        nodeHouseIds.forEach((n, i) => at(i * 700, () => city.pulse(i === 0 ? caller : nodeHouseIds[i - 1]!, n)));
      });
      at(12000, () => caller && city.setHouseholdStatus(caller, "acknowledged"));
      at(14500, () => {
        city.setStorm(false);
        city.setCityLink(true);
        nodeHouseIds.forEach((n, i) => at(i * 500, () => city.uplink(n)));
      });
      at(17000, () => {
        city.setBlackout(0, 0.25);
        if (caller) city.setHouseholdStatus(caller, "ok");
        households.slice(1, 5).forEach((h, i) => at(i * 400, () => city.setHouseholdStatus(h.id, "ok")));
      });
      at(24000, cycle);
    };
    cycle();
  };

  return <CityCanvas households={households} nodeHouseIds={nodeHouseIds} autoRotate interactive={false} onReady={onReady} />;
}
