import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annualized, profileColumns, shareOf } from "../lib/cgi/profile.ts";
import { scenario, toMarkdown, validate, valueCase, type ValueInputs } from "../lib/cgi/valuecase.ts";

const inputs: ValueInputs = {
  annualComplaints: 10_000,
  preventableShare: 0.4,
  costPerComplaint: 50,
  deflection: { low: 0.2, base: 0.35, high: 0.5 },
  implementationCost: 100_000,
  annualRunCost: 20_000,
  years: 3,
  discountRate: 0,
};

describe("value case", () => {
  it("computes the base case by hand-checkable arithmetic", () => {
    const r = scenario(inputs, "base");
    assert.equal(r.complaintsAvoided, 1400); // 10,000 × 0.4 × 0.35
    assert.equal(r.grossSavings, 70_000); // 1,400 × $50
    assert.equal(r.netAnnual, 50_000); // minus $20,000 running cost
    assert.equal(r.paybackMonths, 24); // $100,000 / $50,000 per year
    assert.equal(r.npv, 50_000); // 3 × $50,000 minus $100,000, no discounting
  });
  it("reports no payback when running costs exceed savings", () => {
    const r = scenario({ ...inputs, annualRunCost: 1_000_000 }, "low");
    assert.equal(r.paybackMonths, null);
  });
  it("rejects impossible inputs", () => {
    assert.ok(validate({ ...inputs, preventableShare: 1.4 }).length > 0);
    assert.ok(validate({ ...inputs, deflection: { low: 0.6, base: 0.3, high: 0.5 } }).length > 0);
    assert.equal(validate(inputs).length, 0);
  });
  it("exports a table with every assumption", () => {
    const md = toMarkdown(inputs, valueCase(inputs));
    assert.match(md, /Scenario/);
    assert.match(md, /40% are outage or communication related/);
  });
});

describe("profiler", () => {
  const rows = [
    { category: "Outage", opened: "2024-01-01" },
    { category: "Billing", opened: "2024-07-01" },
    { category: "Outage", opened: "2025-01-01" },
    { category: "", opened: "not a date" },
  ];
  it("counts values per column", () => {
    const p = profileColumns(rows).find((c) => c.name === "category")!;
    assert.deepEqual(p.top[0], { value: "Outage", count: 2 });
    assert.equal(p.filled, 3);
  });
  it("measures the share of selected categories, ignoring blanks", () => {
    assert.deepEqual(shareOf(rows, "category", new Set(["Outage"])), { matched: 2, total: 3, share: 2 / 3 });
  });
  it("annualizes by date span", () => {
    const a = annualized(rows, "opened")!;
    assert.equal(a.from, "2024-01-01");
    assert.ok(Math.abs(a.perYear - 3) < 0.05);
  });
});
