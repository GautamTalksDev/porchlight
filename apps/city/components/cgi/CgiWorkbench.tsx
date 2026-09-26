"use client";

/*
 * The CGI workbench. AI-free by construction:
 *  - files are read with the browser's FileReader and parsed in this tab; nothing is uploaded
 *  - this file and lib/cgi/* never import an AI SDK and never call fetch
 *  - test/ai-firewall.test.ts fails the build if that ever changes
 */
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { annualized, profileColumns, shareOf, type Row } from "@/lib/cgi/profile";
import { toMarkdown, validate, valueCase, type ValueInputs } from "@/lib/cgi/valuecase";

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

export default function CgiWorkbench() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [column, setColumn] = useState<string>("");
  const [dateColumn, setDateColumn] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [inputs, setInputs] = useState<ValueInputs>({
    annualComplaints: 0,
    preventableShare: 0,
    costPerComplaint: 0,
    deflection: { low: 0.2, base: 0.35, high: 0.5 },
    implementationCost: 0,
    annualRunCost: 0,
    years: 3,
    discountRate: 0.08,
  });

  const profiles = useMemo(() => profileColumns(rows), [rows]);
  const current = profiles.find((p) => p.name === column);
  const share = useMemo(() => (column ? shareOf(rows, column, selected) : null), [rows, column, selected]);
  const perYear = useMemo(() => (dateColumn ? annualized(rows, dateColumn) : null), [rows, dateColumn]);
  const problems = validate(inputs);
  const results = problems.length ? [] : valueCase(inputs);

  const load = (file: File) => {
    setParseError(null);
    if (file.size > 50 * 1024 * 1024) {
      setParseError("That file is over 50 MB. Export only the columns you need.");
      return;
    }
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res.data.length) {
          setParseError("No rows found. Is this a CSV with a header row?");
          return;
        }
        setFileName(file.name);
        setRows(res.data);
        setColumn("");
        setDateColumn("");
        setSelected(new Set());
      },
      error: (err) => setParseError(err.message),
    });
  };

  const set = <K extends keyof ValueInputs>(k: K, v: ValueInputs[K]) => setInputs((i) => ({ ...i, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <main className="cgi">
      <div className="cgi-head">
        <h1>The complaint that never gets filed is the cheapest one to handle.</h1>
        <p>
          A working space for the CGI challenge. Load the complaint file, measure which complaints come from being left in
          the dark, and turn that into a value case a CFO can check line by line.
        </p>
        <p className="guarantee">
          <span>
            <strong>No AI touches this data.</strong> Files are read and counted in this browser tab. Nothing is uploaded,
            and this page contains no AI calls. An automated test fails the build if that ever changes.
          </span>
        </p>
      </div>

      <section className="reframe" aria-label="Reframing the brief">
        <blockquote>
          <p>The brief as written</p>
          <p>Automate complaint triage and response with AI to clear the backlog.</p>
        </blockquote>
        <blockquote>
          <p>The question we test with the data</p>
          <p>How many of these complaints exist only because customers were not told what was happening, and can we stop them before they are filed?</p>
        </blockquote>
      </section>

      <section className="cgi-section" aria-labelledby="load-h">
        <h2 id="load-h">1. Load the complaint file</h2>
        <label
          className="drop"
          data-over={String(over)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
        >
          <strong>{fileName ? `${fileName}: ${rows.length.toLocaleString("en-CA")} rows` : "Drop a CSV here or choose a file"}</strong>
          <span>Excel files: save as CSV first. The file stays on this computer.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
            }}
          />
        </label>
        {parseError ? <p className="banner banner-warn">{parseError}</p> : null}
      </section>

      {profiles.length ? (
        <section className="cgi-section" aria-labelledby="measure-h">
          <h2 id="measure-h">2. Measure the preventable share</h2>
          <div className="fields">
            <label className="field">
              Complaint category column
              <select value={column} onChange={(e) => { setColumn(e.target.value); setSelected(new Set()); }}>
                <option value="">Choose a column</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name} ({p.distinct} values)</option>
                ))}
              </select>
            </label>
            <label className="field">
              Date column (to count complaints per year)
              <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                <option value="">Choose a column</option>
                {profiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          {perYear ? (
            <p>
              {Math.round(perYear.perYear).toLocaleString("en-CA")} complaints per year ({perYear.from} to {perYear.to}).{" "}
              <button className="btn btn-quiet btn-small" type="button" onClick={() => set("annualComplaints", Math.round(perYear.perYear))}>Use in the value case</button>
            </p>
          ) : null}
          {current ? (
            <>
              <p className="section-sub">Tick every category that would not exist if the customer had been told what was happening, for example outage, estimated bill or no update.</p>
              <div className="bars">
                {current.top.map((t) => {
                  const on = selected.has(t.value);
                  return (
                    <div key={t.value} className="bar" data-selected={String(on)}>
                      <label>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = new Set(selected);
                            if (on) next.delete(t.value);
                            else next.add(t.value);
                            setSelected(next);
                          }}
                        />
                        {t.value}
                      </label>
                      <span className="bar-track"><span className="bar-fill" style={{ width: `${(t.count / (current.top[0]?.count || 1)) * 100}%`, display: "block" }} /></span>
                      <span>{t.count.toLocaleString("en-CA")}</span>
                    </div>
                  );
                })}
              </div>
              {share && selected.size ? (
                <p>
                  <strong>{Math.round(share.share * 1000) / 10}%</strong> of complaints ({share.matched.toLocaleString("en-CA")} of {share.total.toLocaleString("en-CA")}) fall in the ticked categories.{" "}
                  <button className="btn btn-quiet btn-small" type="button" onClick={() => set("preventableShare", share.share)}>Use in the value case</button>
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <section className="cgi-section" aria-labelledby="value-h">
        <h2 id="value-h">3. Build the value case</h2>
        <p className="section-sub">Take cost figures from CGI&apos;s unit cost file. Deflection rates are assumptions: say where yours come from.</p>
        <div className="fields">
          <label className="field">Complaints per year<input inputMode="numeric" value={inputs.annualComplaints || ""} onChange={(e) => set("annualComplaints", num(e.target.value))} /></label>
          <label className="field">Preventable share (%)<input inputMode="decimal" value={inputs.preventableShare ? Math.round(inputs.preventableShare * 1000) / 10 : ""} onChange={(e) => set("preventableShare", num(e.target.value) / 100)} /></label>
          <label className="field">Cost to handle one complaint ($)<input inputMode="decimal" value={inputs.costPerComplaint || ""} onChange={(e) => set("costPerComplaint", num(e.target.value))} /></label>
          <label className="field">One-time implementation cost ($)<input inputMode="numeric" value={inputs.implementationCost || ""} onChange={(e) => set("implementationCost", num(e.target.value))} /></label>
          <label className="field">Yearly running cost ($)<input inputMode="numeric" value={inputs.annualRunCost || ""} onChange={(e) => set("annualRunCost", num(e.target.value))} /></label>
          {(["low", "base", "high"] as const).map((k) => (
            <label key={k} className="field">
              Deflection, {k} case (%)
              <input inputMode="decimal" value={Math.round(inputs.deflection[k] * 100)} onChange={(e) => set("deflection", { ...inputs.deflection, [k]: num(e.target.value) / 100 })} />
            </label>
          ))}
          <label className="field">Horizon (years)<input inputMode="numeric" value={inputs.years} onChange={(e) => set("years", num(e.target.value))} /></label>
          <label className="field">Discount rate (%)<input inputMode="decimal" value={Math.round(inputs.discountRate * 1000) / 10} onChange={(e) => set("discountRate", num(e.target.value) / 100)} /></label>
        </div>
        {problems.length ? (
          <ul className="assumptions">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        ) : (
          <>
            <div className="table-wrap">
              <table className="value">
                <thead>
                  <tr><th>Scenario</th><th>Complaints avoided per year</th><th>Gross savings per year</th><th>Net per year</th><th>Payback</th><th>Net present value</th></tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.name} className={r.name === "base" ? "total" : undefined}>
                      <td>{r.name === "base" ? "Base case" : r.name === "low" ? "Low case" : "High case"}</td>
                      <td>{Math.round(r.complaintsAvoided).toLocaleString("en-CA")}</td>
                      <td>{money(r.grossSavings)}</td>
                      <td>{money(r.netAnnual)}</td>
                      <td>{r.paybackMonths === null ? "Does not pay back" : `${Math.ceil(r.paybackMonths)} months`}</td>
                      <td>{money(r.npv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="assumptions">
              <p>Complaints avoided = complaints per year × preventable share × deflection.</p>
              <p>Gross savings = complaints avoided × cost per complaint. Net = gross savings minus yearly running cost.</p>
              <p>Net present value discounts each year&apos;s net savings and subtracts the implementation cost.</p>
            </div>
            <div className="actions">
              <button
                className="btn btn-quiet"
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(toMarkdown(inputs, results));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                }}
              >
                {copied ? "Copied" : "Copy the value case as a table"}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
