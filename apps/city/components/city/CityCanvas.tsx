"use client";

import { useEffect, useRef, useState } from "react";
import type { CityHousehold, HouseholdStatus, PorchlightCity } from "@/lib/city/scene";

export interface CityCanvasProps {
  households: (CityHousehold & { status?: HouseholdStatus; lights?: "on" | "off" })[];
  nodeHouseIds: string[];
  labels?: boolean | "all" | "active";
  autoRotate?: boolean;
  interactive?: boolean;
  onSelect?: (id: string) => void;
  onReady?: (city: PorchlightCity) => void;
}

/** Mounts the three.js city. Loaded only in the browser; shows a plain message if WebGL is unavailable. */
export default function CityCanvas({ households, nodeHouseIds, labels, autoRotate, interactive = true, onSelect, onReady }: CityCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cityRef = useRef<PorchlightCity | null>(null);
  const selectRef = useRef(onSelect);
  const [failed, setFailed] = useState(false);
  selectRef.current = onSelect;

  const houseKey = households.map((h) => h.id).join(",");
  useEffect(() => {
    let disposed = false;
    let city: PorchlightCity | null = null;
    (async () => {
      try {
        const { PorchlightCity } = await import("@/lib/city/scene");
        if (disposed || !ref.current) return;
        city = new PorchlightCity(ref.current, households, nodeHouseIds, {
          labels,
          autoRotate,
          interactive,
          onSelect: (id) => selectRef.current?.(id),
        });
        cityRef.current = city;
        for (const h of households) {
          if (h.status) city.setHouseholdStatus(h.id, h.status);
          if (h.lights) city.setHouseholdLights(h.id, h.lights);
        }
        onReady?.(city);
      } catch (err) {
        console.error("3D city unavailable", err);
        setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      city?.dispose();
      cityRef.current = null;
    };
    // The scene is rebuilt only when the set of households changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseKey]);

  useEffect(() => {
    const city = cityRef.current;
    if (!city) return;
    for (const h of households) {
      if (h.status) city.setHouseholdStatus(h.id, h.status);
      city.setHouseholdLights(h.id, h.lights ?? null);
    }
  }, [households]);

  if (failed) {
    return (
      <div className="city city-fallback" role="img" aria-label="3D city unavailable">
        <p>The 3D city needs WebGL, which this browser has turned off. Everything else on this page still works. Use the street list to select homes.</p>
      </div>
    );
  }
  return <div className="city" ref={ref} aria-hidden="true" role="presentation" />;
}
