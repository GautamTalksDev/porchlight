/**
 * CGI value case. Pure arithmetic, no AI, no network. Every input is an assumption the team must
 * source from CGI's data files by hand, and every output shows the formula that produced it.
 */

export interface ValueInputs {
  annualComplaints: number;
  preventableShare: number; // 0..1, measured with the profiler
  costPerComplaint: number; // dollars, from CGI's unit cost file
  deflection: { low: number; base: number; high: number }; // 0..1, share of preventable complaints actually avoided
  implementationCost: number; // one-time, dollars
  annualRunCost: number; // dollars per year
  years: number;
  discountRate: number; // 0..1
}

export interface ScenarioResult {
  name: "low" | "base" | "high";
  deflection: number;
  complaintsAvoided: number;
  grossSavings: number;
  netAnnual: number;
  paybackMonths: number | null;
  npv: number;
}

export function scenario(inputs: ValueInputs, name: ScenarioResult["name"]): ScenarioResult {
  const deflection = inputs.deflection[name];
  const complaintsAvoided = inputs.annualComplaints * inputs.preventableShare * deflection;
  const grossSavings = complaintsAvoided * inputs.costPerComplaint;
  const netAnnual = grossSavings - inputs.annualRunCost;
  const paybackMonths = netAnnual > 0 ? (inputs.implementationCost / netAnnual) * 12 : null;
  let npv = -inputs.implementationCost;
  for (let y = 1; y <= inputs.years; y++) npv += netAnnual / Math.pow(1 + inputs.discountRate, y);
  return { name, deflection, complaintsAvoided, grossSavings, netAnnual, paybackMonths, npv };
}

export function valueCase(inputs: ValueInputs): ScenarioResult[] {
  return (["low", "base", "high"] as const).map((n) => scenario(inputs, n));
}

export function validate(inputs: ValueInputs): string[] {
  const problems: string[] = [];
  if (!(inputs.annualComplaints > 0)) problems.push("Annual complaints must be more than zero.");
  if (inputs.preventableShare < 0 || inputs.preventableShare > 1) problems.push("The preventable share must be between 0% and 100%.");
  if (!(inputs.costPerComplaint >= 0)) problems.push("Cost per complaint cannot be negative.");
  for (const k of ["low", "base", "high"] as const) {
    if (inputs.deflection[k] < 0 || inputs.deflection[k] > 1) problems.push(`The ${k} deflection rate must be between 0% and 100%.`);
  }
  if (inputs.deflection.low > inputs.deflection.base || inputs.deflection.base > inputs.deflection.high) {
    problems.push("Deflection rates should rise from low to base to high.");
  }
  if (inputs.years < 1 || inputs.years > 10) problems.push("Use a horizon between 1 and 10 years.");
  return problems;
}

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/** Plain text summary for slides and the Devpost write-up. */
export function toMarkdown(inputs: ValueInputs, results: ScenarioResult[]): string {
  const rows = results
    .map((r) => `| ${r.name} | ${pct(r.deflection)} | ${Math.round(r.complaintsAvoided).toLocaleString("en-CA")} | ${money(r.grossSavings)} | ${money(r.netAnnual)} | ${r.paybackMonths === null ? "never" : `${Math.ceil(r.paybackMonths)} months`} | ${money(r.npv)} |`)
    .join("\n");
  return [
    "| Scenario | Deflection | Complaints avoided per year | Gross savings | Net per year | Payback | NPV |",
    "| - | - | - | - | - | - | - |",
    rows,
    "",
    "Assumptions:",
    `* ${inputs.annualComplaints.toLocaleString("en-CA")} complaints per year`,
    `* ${pct(inputs.preventableShare)} are outage or communication related (measured from the complaint file)`,
    `* ${money(inputs.costPerComplaint)} to handle one complaint`,
    `* ${money(inputs.implementationCost)} to implement, ${money(inputs.annualRunCost)} per year to run`,
    `* ${inputs.years} year horizon, ${pct(inputs.discountRate)} discount rate`,
  ].join("\n");
}
