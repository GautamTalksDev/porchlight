"use client";

import { useImperativeHandle, useState, forwardRef } from "react";

export type NoticeSeverity = "info" | "urgent";

export interface NoticeView {
  id: string;
  en: string;
  fr: string;
  severity: NoticeSeverity;
  at: number;
  reachedNodes: number;
  totalNodes: number;
}

export interface NoticesApi {
  openWithEnglish: (en: string) => Promise<{ ok: boolean; frFilled: boolean; model?: string; error?: string }>;
  sendCurrent: () => Promise<{ ok: boolean; reason?: string }>;
  getDraft: () => { en: string; fr: string; severity: NoticeSeverity };
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export const NoticesPanel = forwardRef<
  NoticesApi,
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    notices: NoticeView[];
    onSent: () => void;
  }
>(function NoticesPanel({ open, onOpenChange, notices, onSent }, ref) {
  const [en, setEn] = useState("");
  const [fr, setFr] = useState("");
  const [severity, setSeverity] = useState<NoticeSeverity>("info");
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const translate = async (english: string) => {
    setBusy(true);
    setTranslateError(null);
    try {
      const r = await post("/api/notices/translate", { en: english.trim() });
      if (!r.ok) {
        setTranslateError("Gemini is unavailable. Type the French version to send.");
        setModelNote(null);
        return { ok: false as const, frFilled: false, error: String(r.data.reason ?? "unavailable") };
      }
      setFr(String(r.data.fr ?? ""));
      setModelNote(`Drafted by ${r.data.model}. Check it before sending.`);
      return { ok: true as const, frFilled: true, model: String(r.data.model ?? "") };
    } catch {
      setTranslateError("Gemini is unavailable. Type the French version to send.");
      setModelNote(null);
      return { ok: false as const, frFilled: false, error: "unavailable" };
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const enT = en.trim();
    const frT = fr.trim();
    if (!enT || !frT) {
      return {
        ok: false as const,
        reason: !enT && !frT ? "English and French are both required" : !enT ? "English is missing" : "French is missing",
      };
    }
    setBusy(true);
    try {
      const r = await post("/api/notices", { en: enT, fr: frT, severity });
      if (!r.ok) return { ok: false as const, reason: String(r.data.reason ?? "Could not send") };
      setEn("");
      setFr("");
      setModelNote(null);
      setTranslateError(null);
      onSent();
      return { ok: true as const };
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    openWithEnglish: async (text: string) => {
      onOpenChange(true);
      setEn(text);
      setFr("");
      setModelNote(null);
      setTranslateError(null);
      return translate(text);
    },
    sendCurrent: () => send(),
    getDraft: () => ({ en, fr, severity }),
  }));

  if (!open) return null;

  const canSend = Boolean(en.trim() && fr.trim()) && !busy;

  return (
    <div className="notices-panel" role="dialog" aria-label="City notices">
      <div className="preflight-head">
        <h2 className="section-title">Notices</h2>
        <button className="btn btn-quiet btn-small" type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>

      <label className="notice-field" htmlFor="notice-en">
        English
        <textarea
          id="notice-en"
          rows={3}
          maxLength={280}
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder="What should the street hear?"
        />
        <span className="notice-count">{en.length} / 280</span>
      </label>

      <div className="row">
        <button className="btn btn-quiet btn-small" type="button" onClick={() => void translate(en)} disabled={!en.trim() || busy}>
          Draft French
        </button>
      </div>
      {translateError ? <p className="section-sub">{translateError}</p> : null}
      {modelNote ? <p className="section-sub">{modelNote}</p> : null}

      <label className="notice-field" htmlFor="notice-fr">
        French
        <textarea
          id="notice-fr"
          rows={3}
          maxLength={320}
          value={fr}
          onChange={(e) => setFr(e.target.value)}
          placeholder="Version française"
        />
        <span className="notice-count">{fr.length} / 320</span>
      </label>

      <fieldset className="notice-severity">
        <legend>Severity</legend>
        <label>
          <input type="radio" name="severity" checked={severity === "info"} onChange={() => setSeverity("info")} />
          Information
        </label>
        <label>
          <input type="radio" name="severity" checked={severity === "urgent"} onChange={() => setSeverity("urgent")} />
          Urgent
        </label>
      </fieldset>

      <button className="btn btn-porch" type="button" disabled={!canSend} onClick={() => void send()}>
        Send to the street
      </button>

      <h3 className="section-title">Sent</h3>
      {notices.length ? (
        <ul className="notice-sent-list">
          {notices.map((n) => {
            const openFr = expanded.has(n.id);
            return (
              <li key={n.id} data-severity={n.severity}>
                <p className="notice-sent-en">{n.en}</p>
                {openFr ? <p className="section-sub">{n.fr}</p> : null}
                <p className="call-meta">
                  {clock(n.at)} · {n.severity === "urgent" ? "Urgent" : "Information"} · Reached {n.reachedNodes} of{" "}
                  {n.totalNodes} nodes
                </p>
                <button
                  className="btn btn-quiet btn-small"
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    })
                  }
                >
                  {openFr ? "Hide French" : "Show French"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="section-sub">No notices sent yet.</p>
      )}
    </div>
  );
});
