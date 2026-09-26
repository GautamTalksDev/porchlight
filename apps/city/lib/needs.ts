/** Shared need labels and triage weights. Safe for pure logic and the browser. */
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
